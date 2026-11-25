import type { Database } from 'bun:sqlite';

import type {
  HintBinding,
  HintEntry,
  HintJournal,
  HintRepository,
  RepositoryClockOptions,
} from './contracts.ts';
import {
  LocalRepositoryError,
  PENDING_LIMIT,
  assertCas,
  assertId,
  assertRoleId,
  assertVersion,
  claimOperations,
  findLedgerOperation,
  parseBody,
  repositoryNow,
  assertHostTransaction,
} from './shared.ts';

const MAX_ENTRIES = 128;
const HEX_64 = /^[a-f0-9]{64}$/;

interface HintRow {
  user_id: string;
  issue_id: string;
  role_id: string;
  session_id: string;
  question_id: string;
  issued_at: number;
  journal_limit: number;
  version: number;
  committed_count: number;
  reserved_count: number;
  body: string;
  updated_at: number;
}

function validateBinding(binding: HintBinding): void {
  assertId(binding.userId, 'userId');
  assertId(binding.sessionId, 'sessionId');
  assertId(binding.questionId, 'questionId');
  assertRoleId(binding.roleId);
  if (typeof binding.issueId !== 'string' || !HEX_64.test(binding.issueId)) {
    throw new LocalRepositoryError('VALIDATION_ERROR');
  }
  if (!Number.isSafeInteger(binding.issuedAt) || binding.issuedAt < 0) {
    throw new LocalRepositoryError('VALIDATION_ERROR');
  }
}

function validateEntry(entry: HintEntry, expectedLevel: number, lastUpdatedAt: number, seen: Set<string>): number {
  assertId(entry.operationId, 'operationId');
  if (seen.has(entry.operationId)) throw new LocalRepositoryError('VALIDATION_ERROR');
  seen.add(entry.operationId);
  if (entry.level !== 1 && entry.level !== 2) throw new LocalRepositoryError('VALIDATION_ERROR');
  if (!Number.isSafeInteger(entry.reservedAt) || entry.reservedAt < lastUpdatedAt) {
    throw new LocalRepositoryError('VALIDATION_ERROR');
  }
  if (!Number.isSafeInteger(entry.updatedAt) || entry.updatedAt < entry.reservedAt) {
    throw new LocalRepositoryError('VALIDATION_ERROR');
  }
  if (entry.level !== expectedLevel) throw new LocalRepositoryError('VALIDATION_ERROR');
  if (entry.status === 'committed') {
    if (entry.hintVersion !== 'coaching-v1' || typeof entry.text !== 'string') {
      throw new LocalRepositoryError('VALIDATION_ERROR');
    }
    const text = entry.text.trim();
    if (text.length < 1 || text.length > 1000) throw new LocalRepositoryError('VALIDATION_ERROR');
    return 2;
  }
  if ('text' in entry || 'hintVersion' in entry) throw new LocalRepositoryError('VALIDATION_ERROR');
  return entry.status === 'reserved' ? 1 : 2;
}

function validateJournal(journal: HintJournal): { committed: number; reserved: number } {
  if (!journal || typeof journal !== 'object' || journal.schemaVersion !== 1) {
    throw new LocalRepositoryError('VALIDATION_ERROR');
  }
  validateBinding(journal.binding);
  if (journal.limit !== 2) throw new LocalRepositoryError('VALIDATION_ERROR');
  assertVersion(journal.version);
  if (!Array.isArray(journal.entries) || journal.entries.length > MAX_ENTRIES) {
    throw new LocalRepositoryError('VALIDATION_ERROR');
  }

  let committed = 0;
  let reserved = 0;
  let computedVersion = 0;
  let lastUpdatedAt = journal.binding.issuedAt;
  const seen = new Set<string>();
  for (const entry of journal.entries) {
    if (entry.status === 'reserved') {
      if (reserved) throw new LocalRepositoryError('VALIDATION_ERROR');
      reserved++;
    }
    const expectedLevel = committed + 1;
    computedVersion += validateEntry(entry, expectedLevel, lastUpdatedAt, seen);
    if (entry.status === 'committed') committed++;
    lastUpdatedAt = entry.updatedAt;
  }
  if (committed + reserved > 2 || committed > 2 || reserved > 1) {
    throw new LocalRepositoryError('VALIDATION_ERROR');
  }
  if (computedVersion !== journal.version) throw new LocalRepositoryError('VALIDATION_ERROR');
  return { committed, reserved };
}

function sameBinding(row: HintRow, binding: HintBinding): boolean {
  return row.role_id === binding.roleId
    && row.session_id === binding.sessionId
    && row.question_id === binding.questionId
    && row.issued_at === binding.issuedAt;
}

function readJournal(row: HintRow): HintJournal {
  const journal = parseBody<HintJournal>(row.body);
  validateJournal(journal);
  if (!sameBinding(row, journal.binding)) throw new LocalRepositoryError('DATA_INVALID');
  if (journal.version !== row.version) throw new LocalRepositoryError('DATA_INVALID');
  return journal;
}

/** Existing operations keep their level/reservation and committed or released outcomes. */
function assertJournalContinuation(previous: HintJournal, next: HintJournal): void {
  const incoming = new Map(next.entries.map((entry) => [entry.operationId, entry]));
  for (const oldEntry of previous.entries) {
    const entry = incoming.get(oldEntry.operationId);
    if (!entry || entry.level !== oldEntry.level || entry.reservedAt !== oldEntry.reservedAt) {
      throw new LocalRepositoryError('VALIDATION_ERROR');
    }
    if (oldEntry.status === 'committed') {
      if (
        entry.status !== 'committed'
        || entry.text !== oldEntry.text
        || entry.hintVersion !== oldEntry.hintVersion
      ) {
        throw new LocalRepositoryError('VALIDATION_ERROR');
      }
    } else if (oldEntry.status === 'released' && entry.status !== 'released') {
      throw new LocalRepositoryError('VALIDATION_ERROR');
    }
  }
}

/**
 * Profile-scoped hint journal repository. All methods run on the host's existing
 * bun:sqlite connection inside profile.write(...). Nothing here is async or commits.
 */
export function createHintRepository(options: RepositoryClockOptions = {}): HintRepository {
  function loadRows(db: Database, userId: string, issueId: string): HintRow | null {
    return db.query(
      'SELECT * FROM local_hint_journals WHERE user_id = ? AND issue_id = ?',
    ).get(userId, issueId) as HintRow | null;
  }

  return {
    load(db, binding) {
      validateBinding(binding);
      const row = loadRows(db, binding.userId, binding.issueId);
      if (!row) return null;
      if (!sameBinding(row, binding)) throw new LocalRepositoryError('DATA_INVALID');
      return readJournal(row);
    },

    save(db, next, expectedVersion) {
      const counts = validateJournal(next);
      if (expectedVersion !== null) assertVersion(expectedVersion);
      assertHostTransaction(db);
      const row = loadRows(db, next.binding.userId, next.binding.issueId);
      assertCas(expectedVersion, row?.version ?? null);
      if (row) {
        if (!sameBinding(row, next.binding)) throw new LocalRepositoryError('DATA_INVALID');
        const previous = readJournal(row);
        if (next.version <= previous.version) throw new LocalRepositoryError('VERSION_CONFLICT');
        assertJournalContinuation(previous, next);
      }

      const now = repositoryNow(options);
      claimOperations(
        db,
        next.binding.userId,
        'hint',
        next.binding.issueId,
        next.entries.map((entry) => ({ operationId: entry.operationId, digest: null })),
        now,
      );

      db.query(`
        INSERT INTO local_hint_journals
          (user_id, issue_id, role_id, session_id, question_id, issued_at, journal_limit,
           version, committed_count, reserved_count, body, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, issue_id) DO UPDATE SET
          role_id = excluded.role_id,
          session_id = excluded.session_id,
          question_id = excluded.question_id,
          issued_at = excluded.issued_at,
          journal_limit = excluded.journal_limit,
          version = excluded.version,
          committed_count = excluded.committed_count,
          reserved_count = excluded.reserved_count,
          body = excluded.body,
          updated_at = excluded.updated_at
      `).run(
        next.binding.userId,
        next.binding.issueId,
        next.binding.roleId,
        next.binding.sessionId,
        next.binding.questionId,
        next.binding.issuedAt,
        next.limit,
        next.version,
        counts.committed,
        counts.reserved,
        JSON.stringify(next),
        now,
      );
    },

    findOperation(db, userId, operationId) {
      assertId(userId, 'userId');
      const ledger = findLedgerOperation(db, userId, operationId, 'hint');
      if (!ledger) return null;
      const row = loadRows(db, userId, ledger.record_id);
      if (!row) throw new LocalRepositoryError('DATA_INVALID');
      const journal = readJournal(row);
      if (!journal.entries.some((entry) => entry.operationId === operationId)) {
        throw new LocalRepositoryError('DATA_INVALID');
      }
      return journal.binding;
    },

    pending(db, userId) {
      assertId(userId, 'userId');
      const rows = db.query(
        'SELECT * FROM local_hint_journals WHERE user_id = ? AND reserved_count > 0 LIMIT ?',
      ).all(userId, PENDING_LIMIT + 1) as HintRow[];
      if (rows.length > PENDING_LIMIT) throw new LocalRepositoryError('PENDING_LIMIT_EXCEEDED');
      return rows.map((row) => {
        const journal = readJournal(row);
        if (journal.binding.userId !== userId) throw new LocalRepositoryError('DATA_INVALID');
        if (!journal.entries.some((entry) => entry.status === 'reserved')) {
          throw new LocalRepositoryError('DATA_INVALID');
        }
        return journal;
      });
    },
  };
}
