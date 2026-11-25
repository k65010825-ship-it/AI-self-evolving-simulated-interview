import type { Database } from 'bun:sqlite';

import type {
  ExperimentRecordShape,
  ExperimentRepository,
  RepositoryClockOptions,
  RoleId,
} from './contracts.ts';
import {
  LocalRepositoryError,
  PENDING_LIMIT,
  assertCas,
  assertHostTransaction,
  assertId,
  assertOperationContinuation,
  assertOperations,
  assertRoleId,
  assertVersion,
  claimOperations,
  countPendingRuns,
  findLedgerOperation,
  parseBody,
  repositoryNow,
} from './shared.ts';

const MAX_RUNS = 200;
const MAX_OPERATIONS = 200;
const RUN_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted']);

interface ExperimentRow {
  user_id: string;
  experiment_id: string;
  role_id: string;
  version: number;
  pending_run_count: number;
  body: string;
  created_at: number;
  updated_at: number;
}

function validateRecord(record: ExperimentRecordShape): void {
  assertId(record.experimentId, 'experimentId');
  assertRoleId(record.roleId);
  assertVersion(record.version);
  if (!Array.isArray(record.runs) || record.runs.length > MAX_RUNS) {
    throw new LocalRepositoryError('VALIDATION_ERROR');
  }
  for (const run of record.runs) {
    if (!RUN_STATUSES.has(run.status)) throw new LocalRepositoryError('VALIDATION_ERROR');
  }
  assertOperations(record.operations, MAX_OPERATIONS);
}

function readRecord<T extends ExperimentRecordShape>(row: ExperimentRow): T {
  const record = parseBody<T>(row.body);
  validateRecord(record);
  if (
    record.experimentId !== row.experiment_id
    || record.roleId !== row.role_id
    || record.version !== row.version
    || countPendingRuns(record.runs) !== row.pending_run_count
  ) {
    throw new LocalRepositoryError('DATA_INVALID');
  }
  return record;
}

/**
 * Profile-scoped offline experiment repository. Startup recovery stays in the Agent host:
 * pending() returns records with queued/running runs, and the host marks them interrupted
 * through a normal CAS save. deploymentStatus is never persisted here.
 */
export function createExperimentRepository<T extends ExperimentRecordShape = ExperimentRecordShape>(
  options: RepositoryClockOptions = {},
): ExperimentRepository<T> {
  function rowOf(db: Database, userId: string, experimentId: string): ExperimentRow | null {
    return db.query(
      'SELECT * FROM local_experiment_records WHERE user_id = ? AND experiment_id = ?',
    ).get(userId, experimentId) as ExperimentRow | null;
  }

  return {
    load(db, userId, experimentId) {
      assertId(userId, 'userId');
      assertId(experimentId, 'experimentId');
      const row = rowOf(db, userId, experimentId);
      return row ? readRecord<T>(row) : null;
    },

    list(db, userId, roleId?: RoleId) {
      assertId(userId, 'userId');
      if (roleId !== undefined) assertRoleId(roleId);
      const rows = roleId
        ? db.query(
            'SELECT * FROM local_experiment_records WHERE user_id = ? AND role_id = ? ORDER BY updated_at DESC, experiment_id ASC',
          ).all(userId, roleId)
        : db.query(
            'SELECT * FROM local_experiment_records WHERE user_id = ? ORDER BY updated_at DESC, experiment_id ASC',
          ).all(userId);
      return (rows as ExperimentRow[]).map((row) => readRecord<T>(row));
    },

    save(db, userId, next, expectedVersion) {
      assertId(userId, 'userId');
      validateRecord(next);
      if (expectedVersion !== null) assertVersion(expectedVersion);
      assertHostTransaction(db);
      const row = rowOf(db, userId, next.experimentId);
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
        'experiment',
        next.experimentId,
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
        INSERT INTO local_experiment_records
          (user_id, experiment_id, role_id, version, pending_run_count, body, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, experiment_id) DO UPDATE SET
          role_id = excluded.role_id,
          version = excluded.version,
          pending_run_count = excluded.pending_run_count,
          body = excluded.body,
          updated_at = excluded.updated_at
      `).run(
        userId,
        next.experimentId,
        next.roleId,
        next.version,
        countPendingRuns(next.runs),
        JSON.stringify(next),
        now,
        now,
      );
    },

    findOperation(db, userId, operationId) {
      assertId(userId, 'userId');
      const ledger = findLedgerOperation(db, userId, operationId, 'experiment');
      if (!ledger) return null;
      const row = rowOf(db, userId, ledger.record_id);
      if (!row) throw new LocalRepositoryError('DATA_INVALID');
      const record = readRecord<T>(row);
      if (!record.operations.some((operation) => operation.operationId === operationId)) {
        throw new LocalRepositoryError('DATA_INVALID');
      }
      return record;
    },

    pending(db, userId) {
      assertId(userId, 'userId');
      const rows = db.query(
        'SELECT * FROM local_experiment_records WHERE user_id = ? AND pending_run_count > 0 LIMIT ?',
      ).all(userId, PENDING_LIMIT + 1) as ExperimentRow[];
      if (rows.length > PENDING_LIMIT) throw new LocalRepositoryError('PENDING_LIMIT_EXCEEDED');
      return rows.map((row) => readRecord<T>(row));
    },
  };
}
