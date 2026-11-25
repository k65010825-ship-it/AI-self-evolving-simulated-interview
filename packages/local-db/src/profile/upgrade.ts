import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

import {
  PROFILE_SCHEMA_VERSION,
  PROFILE_UPGRADE_SOURCE_VERSION,
  PROFILE_V3_TABLES,
  PROFILE_V4_DDL,
  PROFILE_V4_INDEXES,
  PROFILE_V4_TABLES,
  PROFILE_V4_TRIGGERS,
} from './v4-schema.ts';

export {
  PROFILE_SCHEMA_VERSION,
  PROFILE_UPGRADE_SOURCE_VERSION,
  PROFILE_V3_TABLES,
  PROFILE_V4_TABLES,
} from './v4-schema.ts';

export type ProfileUpgradeCode =
  | 'LOCAL_PATH_INVALID'
  | 'LOCAL_PROFILE_INVALID'
  | 'LOCAL_SCHEMA_UNSUPPORTED'
  | 'LOCAL_PROFILE_ALREADY_UPGRADED'
  | 'LOCAL_SCHEMA_CONFLICT'
  | 'LOCAL_SCHEMA_MISSING'
  | 'LOCAL_BACKUP_INVALID'
  | 'LOCAL_UPGRADE_VERIFICATION_FAILED'
  | 'LOCAL_TRANSACTION_REQUIRED'
  | 'PROFILE_FENCED'
  | 'PROFILE_BINDING_MISMATCH';

export class ProfileUpgradeError extends Error {
  constructor(readonly code: ProfileUpgradeCode) {
    super(code);
    this.name = 'ProfileUpgradeError';
  }
}

function fail(code: ProfileUpgradeCode): never {
  throw new ProfileUpgradeError(code);
}

export interface ProfileUpgradeOptions {
  /** Absolute profile directory that owns profile.sqlite (backups/ is created below it). */
  profileDir: string;
  /** Stable local profile id; must equal local_control.profile_id. */
  profileId: string;
  /** Host lease owner and fence currently held by the caller. */
  owner: string;
  fence: number;
  /** Timestamp used for backup metadata and lease checks. */
  now?: number;
  /** Default true. Only disable for a profile created from an empty database in this startup. */
  backup?: boolean;
}

export interface ProfileUpgradeResult {
  fromVersion: 3;
  toVersion: 4;
  backup: { file: string; digest: string; schemaVersion: 3 } | null;
  preservedTables: number;
  preservedRows: number;
  addedTables: readonly string[];
}

interface ControlRow {
  owner: string;
  fence: number;
  lease_until: number;
  profile_id: string;
  last_time: number;
}

export interface ProfileAuthoritySnapshot {
  digest: string;
  rows: number;
  tables: number;
}

function checkAncestors(path: string): void {
  let at = path;
  for (;;) {
    if (existsSync(at) && lstatSync(at).isSymbolicLink()) fail('LOCAL_PATH_INVALID');
    const parent = dirname(at);
    if (parent === at) break;
    at = parent;
  }
}

function readVersion(db: Database): number {
  const row = db.query('PRAGMA user_version').get() as { user_version?: number } | null;
  const version = row?.user_version;
  if (!Number.isInteger(version)) fail('LOCAL_PROFILE_INVALID');
  return version as number;
}

function readControl(db: Database): ControlRow {
  const row = db.query(
    'SELECT owner, fence, lease_until, profile_id, last_time FROM local_control WHERE id = 1',
  ).get() as ControlRow | null;
  if (!row) fail('LOCAL_PROFILE_INVALID');
  if (
    typeof row.owner !== 'string'
    || !Number.isInteger(row.fence)
    || !Number.isInteger(row.lease_until)
    || !Number.isInteger(row.last_time)
    || typeof row.profile_id !== 'string'
  ) {
    fail('LOCAL_PROFILE_INVALID');
  }
  return row;
}

function tableNames(db: Database): string[] {
  const rows = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  return rows.map((row) => row.name);
}

function assertV3Shape(db: Database): void {
  const existing = new Set(tableNames(db));
  const missing = PROFILE_V3_TABLES.filter((table) => !existing.has(table));
  if (missing.length) fail('LOCAL_SCHEMA_MISSING');
  const known = new Set<string>([...PROFILE_V3_TABLES, ...PROFILE_V4_TABLES]);
  const unknown = [...existing].filter((name) => name.startsWith('local_') && !known.has(name));
  if (unknown.length) fail('LOCAL_SCHEMA_CONFLICT');
  if (PROFILE_V4_TABLES.some((table) => existing.has(table))) fail('LOCAL_SCHEMA_CONFLICT');
}

/**
 * Hash of the authoritative v3 rows, taken before and after DDL. The digest deliberately
 * covers the 17 local_* tables only; it is not a substitute for backup verification.
 */
export function profileAuthoritySnapshot(db: Database): ProfileAuthoritySnapshot {
  const hash = createHash('sha256');
  let rows = 0;
  for (const table of PROFILE_V3_TABLES) {
    const records = db.query(`SELECT * FROM "${table}" ORDER BY rowid`).all() as Record<string, unknown>[];
    hash.update(`${table}:${records.length}\n`);
    for (const record of records) {
      hash.update(JSON.stringify(record));
      hash.update('\n');
    }
    rows += records.length;
  }
  return { digest: hash.digest('hex'), rows, tables: PROFILE_V3_TABLES.length };
}

function createV3Backup(
  db: Database,
  profileDir: string,
  profileId: string,
  now: number,
): { file: string; digest: string; schemaVersion: 3 } {
  if (!isAbsolute(profileDir)) fail('LOCAL_PATH_INVALID');
  checkAncestors(profileDir);
  const directory = join(profileDir, 'backups');
  checkAncestors(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  checkAncestors(directory);

  const file = `v3-${randomUUID()}.sqlite`;
  const path = join(directory, file);
  checkAncestors(path);
  // Bun serializes the complete database image, including committed WAL pages.
  const bytes = db.serialize();
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  const fd = openSync(path, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  const copy = new Database(path, { readonly: true, strict: true });
  try {
    const integrity = copy.query('PRAGMA integrity_check').get() as { integrity_check?: string } | null;
    if (integrity?.integrity_check !== 'ok' || readVersion(copy) !== PROFILE_UPGRADE_SOURCE_VERSION) {
      fail('LOCAL_BACKUP_INVALID');
    }
    copy.exec('PRAGMA foreign_keys = ON');
    if (copy.query('PRAGMA foreign_key_check').all().length) fail('LOCAL_BACKUP_INVALID');
  } finally {
    copy.close();
  }

  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  const manifest = {
    profileId,
    schemaVersion: PROFILE_UPGRADE_SOURCE_VERSION,
    digest,
    file,
    createdAt: now,
  };
  writeFileSync(`${path}.json`, `${JSON.stringify(manifest)}\n`, { flag: 'wx', mode: 0o600 });
  return { file, digest, schemaVersion: PROFILE_UPGRADE_SOURCE_VERSION };
}

/**
 * Upgrade an existing host-managed profile v3 database to v4 in place.
 *
 * Preconditions:
 * - db is the host's existing profile.sqlite connection, inside the host write transaction;
 * - the caller holds the current local_control owner/fence lease;
 * - the database is exactly profile v3 (17 local_* tables, user_version = 3).
 *
 * The function never opens a second database writer, never commits and never starts a
 * transaction. Any failure throws and leaves rollback to the host; the pre-upgrade backup
 * file stays on disk for diagnosis. user_version is set only after DDL and digest checks.
 */
export function upgradeProfileV3ToV4(db: Database, options: ProfileUpgradeOptions): ProfileUpgradeResult {
  if (!isAbsolute(options.profileDir)) fail('LOCAL_PATH_INVALID');
  if (!options.profileId || !options.owner) fail('LOCAL_PROFILE_INVALID');
  if (!Number.isInteger(options.fence) || options.fence < 0) fail('LOCAL_PROFILE_INVALID');
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) fail('LOCAL_PROFILE_INVALID');
  const inTransaction = (db as unknown as { inTransaction?: boolean }).inTransaction;
  if (inTransaction === false) fail('LOCAL_TRANSACTION_REQUIRED');

  const version = readVersion(db);
  if (version > PROFILE_SCHEMA_VERSION) fail('LOCAL_SCHEMA_UNSUPPORTED');
  if (version === PROFILE_SCHEMA_VERSION) fail('LOCAL_PROFILE_ALREADY_UPGRADED');
  if (version !== PROFILE_UPGRADE_SOURCE_VERSION) fail('LOCAL_SCHEMA_UNSUPPORTED');

  const control = readControl(db);
  if (control.last_time > now) fail('LOCAL_PROFILE_INVALID');
  if (control.owner !== options.owner || control.fence !== options.fence) fail('PROFILE_FENCED');
  if (control.lease_until <= now) fail('PROFILE_FENCED');
  if (control.profile_id !== options.profileId) fail('PROFILE_BINDING_MISMATCH');
  const foreignKeyEnforcement = db.query('PRAGMA foreign_keys').get() as { foreign_keys?: number } | null;
  if (foreignKeyEnforcement?.foreign_keys !== 1) fail('LOCAL_PROFILE_INVALID');

  assertV3Shape(db);

  const backup = options.backup === false ? null : createV3Backup(db, options.profileDir, options.profileId, now);
  const before = profileAuthoritySnapshot(db);

  db.exec(PROFILE_V4_DDL);

  const foreignKeys = db.query('PRAGMA foreign_key_check').all();
  if (foreignKeys.length) fail('LOCAL_UPGRADE_VERIFICATION_FAILED');
  const integrity = db.query('PRAGMA integrity_check').get() as { integrity_check?: string } | null;
  if (integrity?.integrity_check !== 'ok') fail('LOCAL_UPGRADE_VERIFICATION_FAILED');

  const after = profileAuthoritySnapshot(db);
  if (after.digest !== before.digest || after.rows !== before.rows) {
    fail('LOCAL_UPGRADE_VERIFICATION_FAILED');
  }

  const current = new Set(tableNames(db));
  if (PROFILE_V4_TABLES.some((table) => !current.has(table))) fail('LOCAL_UPGRADE_VERIFICATION_FAILED');
  const objects = db.query(
    "SELECT name FROM sqlite_master WHERE type IN ('index', 'trigger')",
  ).all() as { name: string }[];
  const objectNames = new Set(objects.map((row) => row.name));
  if (
    PROFILE_V4_INDEXES.some((index) => !objectNames.has(index))
    || PROFILE_V4_TRIGGERS.some((trigger) => !objectNames.has(trigger))
  ) {
    fail('LOCAL_UPGRADE_VERIFICATION_FAILED');
  }

  db.exec(`PRAGMA user_version = ${PROFILE_SCHEMA_VERSION}`);
  if (readVersion(db) !== PROFILE_SCHEMA_VERSION) fail('LOCAL_UPGRADE_VERIFICATION_FAILED');

  return {
    fromVersion: PROFILE_UPGRADE_SOURCE_VERSION,
    toVersion: PROFILE_SCHEMA_VERSION,
    backup,
    preservedTables: before.tables,
    preservedRows: before.rows,
    addedTables: PROFILE_V4_TABLES,
  };
}
