import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';

import {
  ProfileUpgradeError,
  PROFILE_V3_TABLES,
  PROFILE_V4_TABLES,
  profileAuthoritySnapshot,
  upgradeProfileV3ToV4,
} from '../packages/local-db/src/profile/upgrade.ts';
import {
  V3_FENCE,
  V3_NOW,
  V3_OWNER,
  V3_PROFILE_ID,
  V3_SESSION_ID,
  createV3ProfileDb,
} from './fixtures/profile-v3.ts';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'local-profile-upgrade-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function expectCode(fn: () => unknown, code: ProfileUpgradeError['code']): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ProfileUpgradeError);
    expect((error as ProfileUpgradeError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ProfileUpgradeError ${code}`);
}

function tableNames(db: Database): string[] {
  return (db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
    .map((row) => row.name);
}

describe('profile v3 -> v4 backup upgrade', () => {
  test('creates v4 tables, preserves all v3 authority rows and writes a verified backup', () => {
    const dir = tempDir();
    const db = createV3ProfileDb();
    const before = {
      workflow: (db.query('SELECT workflow FROM local_sessions WHERE session_id = ?').get(V3_SESSION_ID) as { workflow: string }).workflow,
      memory: (db.query("SELECT body FROM local_memory WHERE role_id = 'java-backend'").get() as { body: string }).body,
      budget: db.query('SELECT * FROM local_budget WHERE attempt_id = ?').get('attempt-1'),
      checkpoint: db.query('SELECT * FROM local_model_checkpoints WHERE run_id = ?').get('run-1'),
      snapshot: profileAuthoritySnapshot(db),
    };

    const result = db.transaction(() => upgradeProfileV3ToV4(db, {
      profileDir: dir,
      profileId: V3_PROFILE_ID,
      owner: V3_OWNER,
      fence: V3_FENCE,
      now: V3_NOW,
    })).immediate();

    expect(result.fromVersion).toBe(3);
    expect(result.toVersion).toBe(4);
    expect(result.preservedTables).toBe(17);
    expect(result.preservedRows).toBe(before.snapshot.rows);
    expect(result.backup).not.toBeNull();

    expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(4);
    const names = tableNames(db);
    for (const table of PROFILE_V4_TABLES) expect(names).toContain(table);
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);

    expect((db.query('SELECT workflow FROM local_sessions WHERE session_id = ?').get(V3_SESSION_ID) as { workflow: string }).workflow)
      .toBe(before.workflow);
    expect((db.query("SELECT body FROM local_memory WHERE role_id = 'java-backend'").get() as { body: string }).body)
      .toBe(before.memory);
    expect(db.query('SELECT * FROM local_budget WHERE attempt_id = ?').get('attempt-1')).toEqual(before.budget);
    expect(db.query('SELECT * FROM local_model_checkpoints WHERE run_id = ?').get('run-1')).toEqual(before.checkpoint);
    expect(profileAuthoritySnapshot(db).digest).toBe(before.snapshot.digest);

    const workflow = JSON.parse(before.workflow) as {
      hintAssistance?: unknown;
      catalogPin?: unknown;
    };
    expect(workflow.hintAssistance).toBeDefined();
    expect(workflow.catalogPin).toBeDefined();

    const backup = result.backup!;
    const backupPath = join(dir, 'backups', backup.file);
    expect(existsSync(backupPath)).toBe(true);
    expect(createHash('sha256').update(readFileSync(backupPath)).digest('hex')).toBe(backup.digest);
    const manifest = JSON.parse(readFileSync(`${backupPath}.json`, 'utf8')) as {
      profileId: string;
      schemaVersion: number;
      digest: string;
      file: string;
      createdAt: number;
    };
    expect(manifest).toEqual({
      profileId: V3_PROFILE_ID,
      schemaVersion: 3,
      digest: backup.digest,
      file: backup.file,
      createdAt: V3_NOW,
    });

    const copy = new Database(backupPath, { readonly: true, strict: true });
    try {
      expect((copy.query('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok');
      expect((copy.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3);
      expect((copy.query('SELECT workflow FROM local_sessions WHERE session_id = ?').get(V3_SESSION_ID) as { workflow: string }).workflow)
        .toBe(before.workflow);
    } finally {
      copy.close();
    }
  });

  test('rejects a newer profile version without touching the database or backups', () => {
    const dir = tempDir();
    const db = createV3ProfileDb();
    db.exec('PRAGMA user_version = 5');
    expectCode(() => db.transaction(() => upgradeProfileV3ToV4(db, {
      profileDir: dir,
      profileId: V3_PROFILE_ID,
      owner: V3_OWNER,
      fence: V3_FENCE,
      now: V3_NOW,
    })).immediate(), 'LOCAL_SCHEMA_UNSUPPORTED');
    expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(5);
    expect(existsSync(join(dir, 'backups'))).toBe(false);
  });

  test('rejects an already-upgraded or conflicting schema before creating a backup', () => {
    const dir = tempDir();
    const db = createV3ProfileDb();
    db.exec('CREATE TABLE local_hint_journals (user_id TEXT NOT NULL)');
    expectCode(() => db.transaction(() => upgradeProfileV3ToV4(db, {
      profileDir: dir,
      profileId: V3_PROFILE_ID,
      owner: V3_OWNER,
      fence: V3_FENCE,
      now: V3_NOW,
    })).immediate(), 'LOCAL_SCHEMA_CONFLICT');
    expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3);
    expect(existsSync(join(dir, 'backups'))).toBe(false);
  });

  test('lets the host transaction roll back DDL and user_version after a later failure', () => {
    const dir = tempDir();
    const db = createV3ProfileDb();
    expect(() => db.transaction(() => {
      upgradeProfileV3ToV4(db, {
        profileDir: dir,
        profileId: V3_PROFILE_ID,
        owner: V3_OWNER,
        fence: V3_FENCE,
        now: V3_NOW,
      });
      throw new Error('host commit failure');
    }).immediate()).toThrow('host commit failure');

    expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3);
    expect(tableNames(db)).not.toContain('local_business_operations');
    expect(tableNames(db)).not.toContain('local_hint_journals');
    const backups = readdirSync(join(dir, 'backups'));
    expect(backups.some((file) => file.endsWith('.sqlite'))).toBe(true);
  });

  test('requires the caller lease and profile binding', () => {
    const dir = tempDir();
    const db = createV3ProfileDb();
    expectCode(() => db.transaction(() => upgradeProfileV3ToV4(db, {
      profileDir: dir,
      profileId: V3_PROFILE_ID,
      owner: 'another-owner',
      fence: V3_FENCE,
      now: V3_NOW,
    })).immediate(), 'PROFILE_FENCED');

    const expired = createV3ProfileDb();
    expired.query('UPDATE local_control SET lease_until = ? WHERE id = 1').run(V3_NOW);
    expectCode(() => expired.transaction(() => upgradeProfileV3ToV4(expired, {
      profileDir: dir,
      profileId: V3_PROFILE_ID,
      owner: V3_OWNER,
      fence: V3_FENCE,
      now: V3_NOW,
    })).immediate(), 'PROFILE_FENCED');
  });

  test('rejects a missing v3 table', () => {
    const dir = tempDir();
    const db = createV3ProfileDb();
    db.exec('DROP TABLE local_speech_links');
    expectCode(() => db.transaction(() => upgradeProfileV3ToV4(db, {
      profileDir: dir,
      profileId: V3_PROFILE_ID,
      owner: V3_OWNER,
      fence: V3_FENCE,
      now: V3_NOW,
    })).immediate(), 'LOCAL_SCHEMA_MISSING');
  });

  test('supports skipping the backup only for a caller-created empty profile', () => {
    const dir = tempDir();
    const db = createV3ProfileDb();
    const result = db.transaction(() => upgradeProfileV3ToV4(db, {
      profileDir: dir,
      profileId: V3_PROFILE_ID,
      owner: V3_OWNER,
      fence: V3_FENCE,
      now: V3_NOW,
      backup: false,
    })).immediate();
    expect(result.backup).toBeNull();
    expect(existsSync(join(dir, 'backups'))).toBe(false);
    expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(4);
  });

  test('upgrades an empty v3 profile that contains only the control row', () => {
    const dir = tempDir();
    const db = createV3ProfileDb();
    for (const table of PROFILE_V3_TABLES) {
      if (table !== 'local_control') db.exec(`DELETE FROM "${table}"`);
    }
    const result = db.transaction(() => upgradeProfileV3ToV4(db, {
      profileDir: dir,
      profileId: V3_PROFILE_ID,
      owner: V3_OWNER,
      fence: V3_FENCE,
      now: V3_NOW,
    })).immediate();
    expect(result.preservedRows).toBe(1);
    expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(4);
    expect(tableNames(db)).toContain('local_business_operations');
  });

  test('requires the host write transaction', () => {
    const dir = tempDir();
    const db = createV3ProfileDb();
    expectCode(() => upgradeProfileV3ToV4(db, {
      profileDir: dir,
      profileId: V3_PROFILE_ID,
      owner: V3_OWNER,
      fence: V3_FENCE,
      now: V3_NOW,
    }), 'LOCAL_TRANSACTION_REQUIRED');
  });
});
