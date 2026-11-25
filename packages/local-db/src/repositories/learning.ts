import type { Database } from 'bun:sqlite';

import type {
  LearningRecordShape,
  LearningRepository,
  RepositoryClockOptions,
  RoleId,
} from './contracts.ts';
import {
  LocalRepositoryError,
  assertCas,
  assertHostTransaction,
  assertId,
  assertOperationContinuation,
  assertOperations,
  assertRoleId,
  assertVersion,
  claimOperations,
  findLedgerOperation,
  parseBody,
  repositoryNow,
} from './shared.ts';

const MAX_OPERATIONS = 200;

interface LearningRow {
  user_id: string;
  assignment_id: string;
  role_id: string;
  version: number;
  body: string;
  created_at: number;
  updated_at: number;
}

function validateRecord(record: LearningRecordShape): void {
  assertId(record.assignmentId, 'assignmentId');
  assertRoleId(record.roleId);
  assertVersion(record.version);
  assertOperations(record.operations, MAX_OPERATIONS);
}

function readRecord<T extends LearningRecordShape>(row: LearningRow): T {
  const record = parseBody<T>(row.body);
  validateRecord(record);
  if (
    record.assignmentId !== row.assignment_id
    || record.roleId !== row.role_id
    || record.version !== row.version
  ) {
    throw new LocalRepositoryError('DATA_INVALID');
  }
  return record;
}

/**
 * Profile-scoped learning record repository. CAS on record.version plus a profile-wide
 * operation ledger; the caller owns the surrounding profile.write transaction.
 */
export function createLearningRepository<T extends LearningRecordShape = LearningRecordShape>(
  options: RepositoryClockOptions = {},
): LearningRepository<T> {
  function rowOf(db: Database, userId: string, assignmentId: string): LearningRow | null {
    return db.query(
      'SELECT * FROM local_learning_records WHERE user_id = ? AND assignment_id = ?',
    ).get(userId, assignmentId) as LearningRow | null;
  }

  return {
    load(db, userId, assignmentId) {
      assertId(userId, 'userId');
      assertId(assignmentId, 'assignmentId');
      const row = rowOf(db, userId, assignmentId);
      return row ? readRecord<T>(row) : null;
    },

    list(db, userId, roleId?: RoleId) {
      assertId(userId, 'userId');
      if (roleId !== undefined) assertRoleId(roleId);
      const rows = roleId
        ? db.query(
            'SELECT * FROM local_learning_records WHERE user_id = ? AND role_id = ? ORDER BY updated_at DESC, assignment_id ASC',
          ).all(userId, roleId)
        : db.query(
            'SELECT * FROM local_learning_records WHERE user_id = ? ORDER BY updated_at DESC, assignment_id ASC',
          ).all(userId);
      return (rows as LearningRow[]).map((row) => readRecord<T>(row));
    },

    save(db, userId, next, expectedVersion) {
      assertId(userId, 'userId');
      validateRecord(next);
      if (expectedVersion !== null) assertVersion(expectedVersion);
      assertHostTransaction(db);
      const row = rowOf(db, userId, next.assignmentId);
      assertCas(expectedVersion, row?.version ?? null);
      if (row && row.role_id !== next.roleId) throw new LocalRepositoryError('ROLE_FORBIDDEN');
      if (row) {
        const previous = readRecord<T>(row);
        if (next.version <= previous.version) throw new LocalRepositoryError('VERSION_CONFLICT');
      }

      const now = repositoryNow(options);
      claimOperations(
        db,
        userId,
        'learning',
        next.assignmentId,
        next.operations.map((operation) => ({
          operationId: operation.operationId,
          digest: operation.digest,
        })),
        now,
      );
      if (row) {
        const previous = readRecord<T>(row);
        assertOperationContinuation(previous.operations, next.operations);
      }

      db.query(`
        INSERT INTO local_learning_records
          (user_id, assignment_id, role_id, version, body, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, assignment_id) DO UPDATE SET
          role_id = excluded.role_id,
          version = excluded.version,
          body = excluded.body,
          updated_at = excluded.updated_at
      `).run(
        userId,
        next.assignmentId,
        next.roleId,
        next.version,
        JSON.stringify(next),
        now,
        now,
      );
    },

    findOperation(db, userId, operationId) {
      assertId(userId, 'userId');
      const ledger = findLedgerOperation(db, userId, operationId, 'learning');
      if (!ledger) return null;
      const row = rowOf(db, userId, ledger.record_id);
      if (!row) throw new LocalRepositoryError('DATA_INVALID');
      const record = readRecord<T>(row);
      if (!record.operations.some((operation) => operation.operationId === operationId)) {
        throw new LocalRepositoryError('DATA_INVALID');
      }
      return record;
    },
  };
}
