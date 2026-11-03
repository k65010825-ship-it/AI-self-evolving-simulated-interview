import { z } from 'zod';
import { AgentRunRequestSchema, AgentRunSnapshotSchema, MemoryIdentitySchema, WorkflowCommitTicketSchema, WorkflowCommitCurrentSchema,
  WorkflowCommitReceiptSchema, WorkflowCommitDecisionSchema, WorkflowCommitErrorCodeSchema } from '@interview/contracts';
import { WorkflowCommitError, reject, decode, equal, workflowCommitDigest, validateWorkflowTransition } from './commit-validation.ts';
export { WorkflowCommitError, workflowCommitDigest } from './commit-validation.ts';

function guarded<T>(fn: () => T): T {
  try { return fn(); } catch (e) {
    const code = WorkflowCommitErrorCodeSchema.safeParse(e instanceof WorkflowCommitError ? e.code : undefined);
    throw new WorkflowCommitError(code.success ? code.data : 'COMMIT_VALIDATION_ERROR');
  }
}
export function createWorkflowCommitTicket(raw: unknown) {
  return guarded(() => {
    const input = decode(z.object({ identity: MemoryIdentitySchema, request: AgentRunRequestSchema, operationId: z.string().min(1), taskId: z.string().min(1),
      leaseVersion: z.number().int().nonnegative(), expectedStorageVersion: z.number().int().nonnegative().nullable(), expectedMemoryVersion: z.number().int().nonnegative(),
      issuedAt: z.number().int().nonnegative(), leaseUntil: z.number().int().nonnegative() }).strict(), raw);
    const r = input.request;
    if (r.job.type !== 'workflow') reject('COMMIT_UNSUPPORTED_JOB');
    if (r.context.userId !== input.identity.userId || r.context.roleId !== input.identity.roleId) reject('COMMIT_BINDING_INVALID');
    const op = r.job.operation, sessionId = op.action === 'create' ? op.config.session.sessionId : op.snapshot.state.sessionId;
    return decode(WorkflowCommitTicketSchema, { schemaVersion: 1, operationId: input.operationId, taskId: input.taskId, ...input.identity, sessionId,
      runId: r.context.runId, attemptId: r.context.attemptId, inputSnapshotId: r.inputSnapshotId, requestDigest: workflowCommitDigest(r),
      leaseVersion: input.leaseVersion, expectedStorageVersion: input.expectedStorageVersion, expectedMemoryVersion: input.expectedMemoryVersion,
      expectedWorkflowRevision: op.action === 'create' ? null : op.snapshot.revision, issuedAt: input.issuedAt, leaseUntil: input.leaseUntil,
      deadlineAt: r.context.deadlineAt, status: 'running' });
  });
}
/** API-owned inputs only. Returns an uncommitted transaction plan; no database or Agent dependencies. */
export function prepareWorkflowCommit(raw: unknown) {
  return guarded(() => {
    const i = decode(z.object({ ticket: WorkflowCommitTicketSchema, request: AgentRunRequestSchema, run: AgentRunSnapshotSchema,
      current: WorkflowCommitCurrentSchema, receipt: WorkflowCommitReceiptSchema.nullable(), now: z.number().int().nonnegative() }).strict(), raw);
    const { ticket: t, request: request, run, current, receipt, now } = i;
    if (request.job.type !== 'workflow') reject('COMMIT_UNSUPPORTED_JOB');
    const op = request.job.operation, identity = op.action === 'create' ? op.config.identity : op.snapshot.identity;
    const sessionId = op.action === 'create' ? op.config.session.sessionId : op.snapshot.state.sessionId;
    if (request.context.userId !== t.userId || request.context.roleId !== t.roleId || identity.userId !== t.userId || identity.roleId !== t.roleId || sessionId !== t.sessionId ||
      request.context.runId !== t.runId || request.context.attemptId !== t.attemptId || request.inputSnapshotId !== t.inputSnapshotId || request.context.deadlineAt !== t.deadlineAt ||
      workflowCommitDigest(request) !== t.requestDigest || run.runId !== t.runId || run.attemptId !== t.attemptId || run.inputSnapshotId !== t.inputSnapshotId ||
      current.memory.userId !== t.userId || current.memory.roleId !== t.roleId || (current.session && (current.session.workflow.identity.userId !== t.userId ||
        current.session.workflow.identity.roleId !== t.roleId || current.session.workflow.state.sessionId !== t.sessionId))) reject('COMMIT_BINDING_INVALID');
    if (run.status !== 'completed') reject('COMMIT_NOT_COMPLETED');
    if (run.stage !== null || run.error !== null || run.lastEventSeq < 1 || Date.parse(run.updatedAt) < Date.parse(run.createdAt) ||
      run.result?.kind !== 'uncommitted-workflow-result' || run.result.action !== op.action) reject('COMMIT_BINDING_INVALID');
    const candidate = run.result.snapshot;
    if (candidate.identity.userId !== t.userId || candidate.identity.roleId !== t.roleId || candidate.state.sessionId !== t.sessionId) reject('COMMIT_BINDING_INVALID');
    const candidateDigest = workflowCommitDigest(candidate);
    const binding = { operationId: t.operationId, taskId: t.taskId, userId: t.userId, roleId: t.roleId, sessionId: t.sessionId,
      runId: t.runId, attemptId: t.attemptId, inputSnapshotId: t.inputSnapshotId, requestDigest: t.requestDigest };
    if (receipt) {
      // An exact stored receipt acknowledges old work even after expiry or newer session/memory versions.
      if (Object.entries(binding).some(([key, value]) => receipt[key as keyof typeof receipt] !== value) || receipt.candidateDigest !== candidateDigest ||
        receipt.storageFrom !== t.expectedStorageVersion || receipt.storageTo !== (t.expectedStorageVersion ?? -1) + 1 || now < receipt.appliedAt) reject('COMMIT_OPERATION_CONFLICT');
      return WorkflowCommitDecisionSchema.parse({ kind: 'workflow-commit-replay', committed: false, receipt });
    }
    if (t.status !== 'running') reject('COMMIT_TASK_INACTIVE');
    if (now < t.issuedAt) reject('COMMIT_VALIDATION_ERROR');
    if (now >= t.leaseUntil || now >= t.deadlineAt) reject('COMMIT_LEASE_EXPIRED');
    if ((current.session?.storageVersion ?? null) !== t.expectedStorageVersion) reject('COMMIT_VERSION_CONFLICT');
    if (op.action === 'create') {
      if (current.session || t.expectedWorkflowRevision !== null) reject('COMMIT_VERSION_CONFLICT');
      if (!op.config.memory || !equal(op.config.memory, current.memory) || current.memory.version !== t.expectedMemoryVersion) reject('COMMIT_MEMORY_CONFLICT');
    } else {
      if (!current.session || t.expectedWorkflowRevision !== op.snapshot.revision || !equal(current.session.workflow, op.snapshot)) reject('COMMIT_VERSION_CONFLICT');
    }
    validateWorkflowTransition(op, candidate, now);
    const firstClose = op.action === 'finish' && op.snapshot.phase !== 'completed';
    const memoryWrite = firstClose && candidate.closeout!.memoryDisposition === 'appended' ? candidate.closeout!.memoryCandidate : null;
    const checkMemory = op.action === 'create' || memoryWrite !== null;
    if (memoryWrite && (current.memory.version !== t.expectedMemoryVersion || !equal(current.memory, candidate.baseMemory))) reject('COMMIT_MEMORY_CONFLICT');
    const storageVersion = (t.expectedStorageVersion ?? -1) + 1;
    return WorkflowCommitDecisionSchema.parse({ kind: 'uncommitted-workflow-commit-plan', committed: false, preparedAt: now,
      where: { ...binding, expectedTaskStatus: 'running', leaseVersion: t.leaseVersion, expectedStorageVersion: t.expectedStorageVersion,
        expectedWorkflowDigest: current.session ? workflowCommitDigest(current.session.workflow) : null,
        expectedMemoryVersion: checkMemory ? current.memory.version : null, expectedMemoryDigest: checkMemory ? workflowCommitDigest(current.memory) : null,
        leaseUntil: t.leaseUntil, deadlineAt: t.deadlineAt },
      sessionWrite: { storageVersion, workflow: candidate }, memoryWrite,
      receiptCandidate: { schemaVersion: 1, ...binding, candidateDigest, storageFrom: t.expectedStorageVersion, storageTo: storageVersion,
        memoryFrom: memoryWrite ? current.memory.version : null, memoryTo: memoryWrite ? memoryWrite.version : null, appliedAt: now } });
  });
}
