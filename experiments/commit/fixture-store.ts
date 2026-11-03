import { z } from 'zod';
import { AgentRunRequestSchema, MemoryIdentitySchema, MemorySnapshotSchema, WorkflowCommitDecisionSchema,
  type AgentRunRequest, type WorkflowCommitTicket, type WorkflowCommitReceipt, type WorkflowCommitPlan } from '../../packages/contracts/src/index.ts';
import { createWorkflowCommitTicket, prepareWorkflowCommit, workflowCommitDigest, WorkflowCommitError } from '../../packages/agent-client/src/workflow-commit.ts';

const equal = (a: unknown, b: unknown) => workflowCommitDigest(a) === workflowCommitDigest(b);
function fail(code: ConstructorParameters<typeof WorkflowCommitError>[0]): never { throw new WorkflowCommitError(code); }
/** Transaction/CAS simulation ONLY. No database, durable receipt, auth or cross-process lock. */
export function createWorkflowCommitFixtureStore(raw: unknown) {
  const config = z.object({ identity: MemoryIdentitySchema, sessionId: z.string().min(1), memory: MemorySnapshotSchema }).strict().parse(raw);
  if (config.memory.userId !== config.identity.userId || config.memory.roleId !== config.identity.roleId) fail('COMMIT_BINDING_INVALID');
  let state: { session: WorkflowCommitPlan['sessionWrite'] | null; memory: typeof config.memory } = { session: null, memory: config.memory };
  const tasks = new Map<string, { ticket: WorkflowCommitTicket; request: AgentRunRequest }>(), receipts = new Map<string, WorkflowCommitReceipt>();
  const prepared = new Set<string>();
  const current = () => structuredClone(state);
  function stage(rawRequest: unknown, meta: { operationId: string; taskId: string; now: number; leaseMs: number }) {
    if (!Number.isSafeInteger(meta.leaseMs) || meta.leaseMs < 1 || meta.leaseMs > 60000) fail('COMMIT_VALIDATION_ERROR');
    const request = AgentRunRequestSchema.parse(rawRequest), existing = tasks.get(meta.taskId);
    if (existing) { if (existing.ticket.operationId === meta.operationId && equal(existing.request, request)) return meta.taskId; fail('COMMIT_OPERATION_CONFLICT'); }
    if (tasks.size >= 64 || [...tasks.values()].some(t => t.ticket.operationId === meta.operationId)) fail('COMMIT_OPERATION_CONFLICT');
    const ticket = createWorkflowCommitTicket({ identity: config.identity, request, operationId: meta.operationId, taskId: meta.taskId,
      leaseVersion: 1, expectedStorageVersion: state.session?.storageVersion ?? null, expectedMemoryVersion: state.memory.version,
      issuedAt: meta.now, leaseUntil: meta.now + meta.leaseMs });
    if (ticket.sessionId !== config.sessionId) fail('COMMIT_BINDING_INVALID');
    tasks.set(meta.taskId, { ticket, request }); return meta.taskId;
  }
  function prepare(taskId: string, run: unknown, now: number) {
    const task = tasks.get(taskId); if (!task) fail('COMMIT_BINDING_INVALID');
    const decision = prepareWorkflowCommit({ ticket: task.ticket, request: task.request, run, current: state, receipt: receipts.get(task.ticket.operationId) ?? null, now });
    if (decision.kind === 'uncommitted-workflow-commit-plan') prepared.add(workflowCommitDigest(decision));
    return decision;
  }
  function apply(rawDecision: unknown, now: number, options: { failBeforeCommit?: boolean } = {}) {
    if (!Number.isSafeInteger(now) || now < 0) fail('COMMIT_VALIDATION_ERROR');
    const d = WorkflowCommitDecisionSchema.parse(rawDecision);
    if (d.kind === 'workflow-commit-replay') {
      const old = receipts.get(d.receipt.operationId);
      if (!old || !equal(old, d.receipt) || now < old.appliedAt) fail('COMMIT_OPERATION_CONFLICT');
      return { effect: 'replayed-in-memory' as const, formalCommitted: false as const, receipt: structuredClone(old) };
    }
    // A hash is not an authorization token. This fixture only applies exact plans it admitted privately.
    if (!prepared.has(workflowCommitDigest(d))) fail('COMMIT_BINDING_INVALID');
    const task = tasks.get(d.where.taskId); if (!task) fail('COMMIT_BINDING_INVALID');
    const old = receipts.get(d.where.operationId);
    if (old) {
      const { appliedAt: _a, ...stored } = old, { appliedAt: _b, ...candidate } = d.receiptCandidate;
      if (!equal(stored, candidate) || now < old.appliedAt) fail('COMMIT_OPERATION_CONFLICT');
      return { effect: 'replayed-in-memory' as const, formalCommitted: false as const, receipt: structuredClone(old) };
    }
    if (task.ticket.leaseVersion !== d.where.leaseVersion) fail('COMMIT_TASK_FENCED');
    if (task.ticket.status !== d.where.expectedTaskStatus) fail('COMMIT_TASK_INACTIVE');
    if (now < d.preparedAt || now < task.ticket.issuedAt) fail('COMMIT_VALIDATION_ERROR');
    if (now >= task.ticket.leaseUntil || now >= task.ticket.deadlineAt) fail('COMMIT_LEASE_EXPIRED');
    if (task.ticket.requestDigest !== d.where.requestDigest || task.ticket.runId !== d.where.runId || task.ticket.attemptId !== d.where.attemptId ||
      task.ticket.inputSnapshotId !== d.where.inputSnapshotId || task.ticket.leaseUntil !== d.where.leaseUntil || task.ticket.deadlineAt !== d.where.deadlineAt) fail('COMMIT_BINDING_INVALID');
    if ((state.session?.storageVersion ?? null) !== d.where.expectedStorageVersion ||
      (state.session ? workflowCommitDigest(state.session.workflow) : null) !== d.where.expectedWorkflowDigest) fail('COMMIT_VERSION_CONFLICT');
    if (d.where.expectedMemoryVersion !== null && (state.memory.version !== d.where.expectedMemoryVersion || workflowCommitDigest(state.memory) !== d.where.expectedMemoryDigest)) fail('COMMIT_MEMORY_CONFLICT');
    const nextState = { session: structuredClone(d.sessionWrite), memory: structuredClone(d.memoryWrite ?? state.memory) };
    const receipt = { ...d.receiptCandidate, appliedAt: now };
    if (options.failBeforeCommit) throw new Error('COMMIT_FIXTURE_ABORT');
    // One synchronous swap after every check: test simulation, not a SQL transaction.
    state = nextState; receipts.set(task.ticket.operationId, receipt); task.ticket = { ...task.ticket, status: 'committed' };
    return { effect: 'applied-in-memory' as const, formalCommitted: false as const, receipt: structuredClone(receipt) };
  }
  function cancel(taskId: string) {
    const t = tasks.get(taskId); if (!t || t.ticket.status !== 'running') fail('COMMIT_TASK_INACTIVE');
    t.ticket = { ...t.ticket, status: 'cancelled' };
  }
  function replaceAttempt(taskId: string, rawRequest: unknown, now: number) {
    const t = tasks.get(taskId), request = AgentRunRequestSchema.parse(rawRequest);
    if (!t || t.ticket.status !== 'running') fail('COMMIT_TASK_INACTIVE');
    if (request.context.attemptId === t.request.context.attemptId) fail('COMMIT_BINDING_INVALID');
    const semantic = (r: AgentRunRequest) => {
      if (r.job.type !== 'workflow') fail('COMMIT_UNSUPPORTED_JOB');
      const op = r.job.operation;
      return { inputSnapshotId: r.inputSnapshotId, job: { type: 'workflow', operation: ('command' in op && 'context' in op.command)
        ? { ...op, command: { ...op.command, context: null } } : op } };
    };
    if (!equal(semantic(request), semantic(t.request))) fail('COMMIT_BINDING_INVALID');
    const ticket = createWorkflowCommitTicket({ identity: config.identity, request, operationId: t.ticket.operationId, taskId,
      leaseVersion: t.ticket.leaseVersion + 1, expectedStorageVersion: t.ticket.expectedStorageVersion, expectedMemoryVersion: t.ticket.expectedMemoryVersion,
      issuedAt: now, leaseUntil: now + 30000 });
    t.request = request; t.ticket = ticket;
  }
  function advanceMemory(rawMemory: unknown) {
    const memory = MemorySnapshotSchema.parse(rawMemory);
    if (memory.userId !== config.identity.userId || memory.roleId !== config.identity.roleId || memory.version !== state.memory.version + 1) fail('COMMIT_MEMORY_CONFLICT');
    state = { ...state, memory };
  }
  return { current, stage, prepare, apply, cancel, replaceAttempt, advanceMemory, receiptCount: () => receipts.size };
}
