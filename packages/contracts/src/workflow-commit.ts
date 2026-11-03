import { z } from 'zod';
import { MemoryIdentitySchema, MemorySnapshotSchema } from './memory.ts';
import { WorkflowSchema } from './session-workflow.ts';
const id = z.string().min(1).max(1000), version = z.number().int().min(0).max(1_000_000_000), time = z.number().int().nonnegative();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const binding = { operationId: id, taskId: id, ...MemoryIdentitySchema.shape, sessionId: id,
  runId: id, attemptId: id, inputSnapshotId: id, requestDigest: digest };
export const WorkflowCommitTicketSchema = z.object({ schemaVersion: z.literal(1), ...binding, leaseVersion: version,
  expectedStorageVersion: version.nullable(), expectedMemoryVersion: version, expectedWorkflowRevision: version.nullable(),
  issuedAt: time, leaseUntil: time, deadlineAt: time, status: z.enum(['running', 'cancelled', 'superseded', 'committed']) }).strict()
  .refine(t => t.leaseUntil > t.issuedAt && t.deadlineAt > t.issuedAt, 'Invalid lease time');
export const WorkflowStoredRowSchema = z.object({ storageVersion: version, workflow: WorkflowSchema }).strict();
export const WorkflowCommitCurrentSchema = z.object({ session: WorkflowStoredRowSchema.nullable(), memory: MemorySnapshotSchema }).strict();
export const WorkflowCommitReceiptSchema = z.object({ schemaVersion: z.literal(1), ...binding, candidateDigest: digest,
  storageFrom: version.nullable(), storageTo: version, memoryFrom: version.nullable(), memoryTo: version.nullable(), appliedAt: time }).strict();
export const WorkflowCommitPlanSchema = z.object({ kind: z.literal('uncommitted-workflow-commit-plan'), committed: z.literal(false), preparedAt: time,
  where: z.object({ ...binding, expectedTaskStatus: z.literal('running'), leaseVersion: version, expectedStorageVersion: version.nullable(), expectedWorkflowDigest: digest.nullable(),
    expectedMemoryVersion: version.nullable(), expectedMemoryDigest: digest.nullable(), leaseUntil: time, deadlineAt: time }).strict(),
  sessionWrite: WorkflowStoredRowSchema, memoryWrite: MemorySnapshotSchema.nullable(), receiptCandidate: WorkflowCommitReceiptSchema,
}).strict();
export const WorkflowCommitReplaySchema = z.object({ kind: z.literal('workflow-commit-replay'), committed: z.literal(false), receipt: WorkflowCommitReceiptSchema }).strict();
export const WorkflowCommitDecisionSchema = z.discriminatedUnion('kind', [WorkflowCommitPlanSchema, WorkflowCommitReplaySchema]);
export const WorkflowCommitErrorCodeSchema = z.enum(['COMMIT_VALIDATION_ERROR', 'COMMIT_BINDING_INVALID', 'COMMIT_NOT_COMPLETED', 'COMMIT_UNSUPPORTED_JOB',
  'COMMIT_TASK_INACTIVE', 'COMMIT_LEASE_EXPIRED', 'COMMIT_VERSION_CONFLICT', 'COMMIT_MEMORY_CONFLICT', 'COMMIT_TRANSITION_INVALID',
  'COMMIT_OPERATION_CONFLICT', 'COMMIT_TASK_FENCED']);
export type WorkflowCommitTicket = z.infer<typeof WorkflowCommitTicketSchema>;
export type WorkflowCommitCurrent = z.infer<typeof WorkflowCommitCurrentSchema>;
export type WorkflowCommitReceipt = z.infer<typeof WorkflowCommitReceiptSchema>;
export type WorkflowCommitPlan = z.infer<typeof WorkflowCommitPlanSchema>;
export type WorkflowCommitErrorCode = z.infer<typeof WorkflowCommitErrorCodeSchema>;
