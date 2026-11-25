import type { Database } from 'bun:sqlite';

/**
 * Branch-local structural mirrors of the feature/agent repository ports and record shapes.
 *
 * feature/db does not yet contain the shared hint/learning/experiment contracts (they live on
 * feature/agent). The local host validates records with the shared Zod contracts before
 * calling these repositories, so only identity/version/operation fields are needed here.
 * When the branches merge, these types can be replaced by imports from @interview/contracts
 * without changing the runtime implementation.
 */
export type RoleId = 'java-backend' | 'web-frontend';

export interface HintBinding {
  userId: string;
  roleId: RoleId;
  sessionId: string;
  issueId: string;
  questionId: string;
  issuedAt: number;
}

interface HintEntryBase {
  operationId: string;
  level: 1 | 2;
  reservedAt: number;
  updatedAt: number;
}

export type HintEntry =
  | (HintEntryBase & { status: 'reserved' })
  | (HintEntryBase & { status: 'released' })
  | (HintEntryBase & {
      status: 'committed';
      text: string;
      hintVersion: 'coaching-v1';
    });

export interface HintJournal {
  schemaVersion: 1;
  binding: HintBinding;
  limit: 2;
  version: number;
  entries: HintEntry[];
}

export interface HintRepository {
  load(db: Database, binding: HintBinding): HintJournal | null;
  save(db: Database, next: HintJournal, expectedVersion: number | null): void;
  findOperation(db: Database, userId: string, operationId: string): HintBinding | null;
  pending(db: Database, userId: string): HintJournal[];
}

export interface LearningOperationReceiptShape {
  operationId: string;
  kind: string;
  digest: string;
  processedAt: number;
  result: unknown;
}

export interface LearningRecordShape {
  assignmentId: string;
  roleId: RoleId;
  version: number;
  operations: readonly LearningOperationReceiptShape[];
}

export interface LearningRepository<T extends LearningRecordShape = LearningRecordShape> {
  load(db: Database, userId: string, assignmentId: string): T | null;
  list(db: Database, userId: string, roleId?: RoleId): T[];
  save(db: Database, userId: string, next: T, expectedVersion: number | null): void;
  findOperation(db: Database, userId: string, operationId: string): T | null;
}

export interface ExperimentRunShape {
  status: string;
}

export interface ExperimentOperationReceiptShape {
  operationId: string;
  action: string;
  digest: string;
  processedAt: number;
  result: unknown;
}

export interface ExperimentRecordShape {
  experimentId: string;
  roleId: RoleId;
  version: number;
  runs: readonly ExperimentRunShape[];
  operations: readonly ExperimentOperationReceiptShape[];
}

export interface ExperimentRepository<T extends ExperimentRecordShape = ExperimentRecordShape> {
  load(db: Database, userId: string, experimentId: string): T | null;
  list(db: Database, userId: string, roleId?: RoleId): T[];
  save(db: Database, userId: string, next: T, expectedVersion: number | null): void;
  findOperation(db: Database, userId: string, operationId: string): T | null;
  pending(db: Database, userId: string): T[];
}

export interface RepositoryClockOptions {
  /** Injectable clock for deterministic tests; defaults to Date.now. */
  now?: () => number;
}
