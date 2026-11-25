import type { Database } from 'bun:sqlite';

import type { RepositoryClockOptions, RoleId } from './contracts.ts';

export type LocalRepositoryCode =
  | 'VALIDATION_ERROR'
  | 'VERSION_CONFLICT'
  | 'OPERATION_CONFLICT'
  | 'ROLE_FORBIDDEN'
  | 'DATA_INVALID'
  | 'PENDING_LIMIT_EXCEEDED'
  | 'LOCAL_CLOCK_INVALID'
  | 'TRANSACTION_REQUIRED';

export class LocalRepositoryError extends Error {
  constructor(readonly code: LocalRepositoryCode) {
    super(code);
    this.name = 'LocalRepositoryError';
  }
}

export type OperationKind = 'hint' | 'learning' | 'experiment';

export interface OperationClaim {
  operationId: string;
  digest: string | null;
}

export interface OperationLedgerRow {
  kind: string;
  record_id: string;
  digest: string | null;
}

const ROLE_IDS = new Set<string>(['java-backend', 'web-frontend']);
const HEX_64 = /^[a-f0-9]{64}$/;
export const PENDING_LIMIT = 4000;

export function repositoryNow(options: RepositoryClockOptions): number {
  const now = options.now ? options.now() : Date.now();
  if (!Number.isSafeInteger(now) || now < 0) throw new LocalRepositoryError('LOCAL_CLOCK_INVALID');
  return now;
}

/** Writes must join the host's profile.write transaction; autocommit is not accepted. */
export function assertHostTransaction(db: Database): void {
  if ((db as unknown as { inTransaction?: boolean }).inTransaction === false) {
    throw new LocalRepositoryError('TRANSACTION_REQUIRED');
  }
}

export function assertId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) {
    throw new LocalRepositoryError('VALIDATION_ERROR');
  }
  if (field === 'issueId' && !HEX_64.test(value)) throw new LocalRepositoryError('VALIDATION_ERROR');
}

export function assertRoleId(value: unknown): asserts value is RoleId {
  if (typeof value !== 'string' || !ROLE_IDS.has(value)) throw new LocalRepositoryError('ROLE_FORBIDDEN');
}

export function assertVersion(value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new LocalRepositoryError('VALIDATION_ERROR');
}

export function assertDigest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !HEX_64.test(value)) throw new LocalRepositoryError('VALIDATION_ERROR');
}

export function assertCas(expectedVersion: number | null, actualVersion: number | null): void {
  if (expectedVersion !== null) assertVersion(expectedVersion);
  if (expectedVersion !== actualVersion) throw new LocalRepositoryError('VERSION_CONFLICT');
}

export function parseBody<T>(body: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new LocalRepositoryError('DATA_INVALID');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LocalRepositoryError('DATA_INVALID');
  }
  return parsed as T;
}

export function assertOperations(
  operations: readonly { operationId: string; digest: string }[],
  max: number,
): void {
  if (!Array.isArray(operations) || operations.length > max) throw new LocalRepositoryError('VALIDATION_ERROR');
  const seen = new Set<string>();
  for (const operation of operations) {
    assertId(operation.operationId, 'operationId');
    assertDigest(operation.digest);
    if (seen.has(operation.operationId)) throw new LocalRepositoryError('VALIDATION_ERROR');
    seen.add(operation.operationId);
  }
}

/** Operation logs are append-only; an existing id may not disappear or change its digest. */
export function assertOperationContinuation(
  previous: readonly { operationId: string; digest: string }[],
  next: readonly { operationId: string; digest: string }[],
): void {
  const incoming = new Map(next.map((operation) => [operation.operationId, operation]));
  for (const operation of previous) {
    const current = incoming.get(operation.operationId);
    if (!current || current.digest !== operation.digest) {
      throw new LocalRepositoryError('VALIDATION_ERROR');
    }
  }
}

/**
 * Claim every operation receipt in the record against the profile-wide ledger.
 * Existing rows must describe the same kind/record/digest; anything else is a conflict.
 * The caller already holds the host write transaction, so this is synchronous and atomic.
 */
export function claimOperations(
  db: Database,
  userId: string,
  kind: OperationKind,
  recordId: string,
  operations: readonly OperationClaim[],
  now: number,
): void {
  const select = db.query(
    'SELECT kind, record_id, digest FROM local_business_operations WHERE user_id = ? AND operation_id = ?',
  );
  const insert = db.query(
    'INSERT INTO local_business_operations (user_id, operation_id, kind, record_id, digest, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const operation of operations) {
    const existing = select.get(userId, operation.operationId) as OperationLedgerRow | null;
    if (existing) {
      if (
        existing.kind !== kind
        || existing.record_id !== recordId
        || existing.digest !== operation.digest
      ) {
        // Same operationId with different content/scope is a version conflict for the caller.
        throw new LocalRepositoryError('VERSION_CONFLICT');
      }
      continue;
    }
    try {
      insert.run(userId, operation.operationId, kind, recordId, operation.digest, now);
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const message = error instanceof Error ? error.message : '';
      const unique = (typeof code === 'string' && code.includes('CONSTRAINT_UNIQUE'))
        || message.includes('UNIQUE constraint failed');
      if (unique) throw new LocalRepositoryError('VERSION_CONFLICT');
      throw error;
    }
  }
}

/**
 * Resolve a stored operation for findOperation. A ledger row for another module is a
 * fail-closed conflict rather than an empty lookup.
 */
export function findLedgerOperation(
  db: Database,
  userId: string,
  operationId: string,
  expectedKind: OperationKind,
): OperationLedgerRow | null {
  assertId(operationId, 'operationId');
  const row = db.query(
    'SELECT kind, record_id, digest FROM local_business_operations WHERE user_id = ? AND operation_id = ?',
  ).get(userId, operationId) as OperationLedgerRow | null;
  if (!row) return null;
  if (row.kind !== expectedKind) throw new LocalRepositoryError('OPERATION_CONFLICT');
  return row;
}

export function countPendingRuns(runs: readonly { status: string }[]): number {
  let count = 0;
  for (const run of runs) {
    if (run.status === 'queued' || run.status === 'running') count++;
  }
  return count;
}
