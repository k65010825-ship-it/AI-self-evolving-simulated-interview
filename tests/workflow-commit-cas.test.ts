import { test, expect } from 'bun:test';
import { commitSource } from './helpers/commit-source.ts';
import { createWorkflowCommitFixtureStore } from '../experiments/commit/fixture-store.ts';
import type { AgentRunRequest } from '../packages/contracts/src/agent-run.ts';

async function fixture() {
  const f = await commitSource();
  const store = createWorkflowCommitFixtureStore({ identity: f.identity, sessionId: f.ticket.sessionId, memory: f.current.memory });
  const taskId = store.stage(f.request, { taskId: 'create-task', operationId: 'create-op', now: Date.now(), leaseMs: 30000 });
  const plan = store.prepare(taskId, f.run, Date.now()); store.apply(plan, Date.now());
  return { ...f, store, firstPlan: plan, taskId };
}
function planRequest(f: Awaited<ReturnType<typeof fixture>>, name: string): AgentRunRequest {
  const snapshot = f.store.current().session!.workflow;
  const context = { ...f.request.context, runId: name, attemptId: 'a', deadlineAt: Date.now() + 60000 };
  return { inputSnapshotId: name, context, job: { type: 'workflow', operation: { action: 'plan', snapshot,
    command: { identity: f.identity, expectedRevision: snapshot.revision, context } } } };
}
test('two computed plans race on the same row; only one applies and old exact receipt replay remains valid', async () => {
  const f = await fixture();
  try {
    const a = planRequest(f, 'plan-a'), b = planRequest(f, 'plan-b');
    const ta = f.store.stage(a, { taskId: 'a', operationId: 'op-a', now: Date.now(), leaseMs: 30000 });
    const tb = f.store.stage(b, { taskId: 'b', operationId: 'op-b', now: Date.now(), leaseMs: 30000 });
    const pa = f.store.prepare(ta, await f.execute(a), Date.now()), pb = f.store.prepare(tb, await f.execute(b), Date.now());
    expect(f.store.apply(pa, Date.now()).effect).toBe('applied-in-memory');
    expect(() => f.store.apply(pb, Date.now())).toThrow('COMMIT_VERSION_CONFLICT');
    expect(f.store.current().session!.storageVersion).toBe(1);
    const replay = f.store.prepare(f.taskId, f.run, f.ticket.deadlineAt + 1000);
    expect(replay.kind).toBe('workflow-commit-replay');
    expect(f.store.apply(replay, f.ticket.deadlineAt + 1000).effect).toBe('replayed-in-memory');
    expect(f.store.current().session!.storageVersion).toBe(1);
  } finally { f.runtime.dispose(); }
});
test('cancellation, fencing, expiry and plan tampering are rechecked after preparation', async () => {
  for (const mode of ['cancel', 'fence', 'expire', 'tamper'] as const) {
    const f = await fixture();
    try {
      const request = planRequest(f, `guard-${mode}`), task = f.store.stage(request, { taskId: 'guard', operationId: 'guard-op', now: Date.now(), leaseMs: 30000 });
      const plan = f.store.prepare(task, await f.execute(request), Date.now());
      if (plan.kind !== 'uncommitted-workflow-commit-plan') throw new Error('Expected plan');
      if (mode === 'cancel') f.store.cancel(task);
      if (mode === 'fence') f.store.replaceAttempt(task, { ...request, context: { ...request.context, attemptId: 'new-attempt' },
        job: request.job.type === 'workflow' && request.job.operation.action === 'plan' ? { type: 'workflow', operation: { ...request.job.operation,
          command: { ...request.job.operation.command, context: { ...request.context, attemptId: 'new-attempt' } } } } : request.job }, Date.now());
      if (mode === 'tamper') plan.sessionWrite.workflow.goal = 'tampered';
      expect(() => f.store.apply(plan, mode === 'expire' ? plan.where.leaseUntil : Date.now())).toThrow(mode === 'cancel' ? 'COMMIT_TASK_INACTIVE' : mode === 'fence' ? 'COMMIT_TASK_FENCED' : mode === 'expire' ? 'COMMIT_LEASE_EXPIRED' : 'COMMIT_BINDING_INVALID');
      expect(f.store.current().session!.storageVersion).toBe(0);
    } finally { f.runtime.dispose(); }
  }
});

test('selected question and rubric must bind to the trusted role, skill and retrieved item', async () => {
  const f = await fixture();
  try {
    const request = planRequest(f, 'role-binding'), task = f.store.stage(request, { taskId: 'binding', operationId: 'binding-op', now: Date.now(), leaseMs: 30000 });
    const original = await f.execute(request);
    for (const mode of ['role', 'skill', 'rubric'] as const) {
      const run = structuredClone(original);
      if (run.result?.kind !== 'uncommitted-workflow-result' || !run.result.snapshot.current || run.result.snapshot.lastPlan?.selection.status !== 'selected') throw new Error('Expected selected');
      const current = run.result.snapshot.current, selected = run.result.snapshot.lastPlan.selection;
      if (mode === 'role') { current.question.roleId = selected.question.roleId = 'web-frontend'; current.rubric.roleId = selected.rubric.roleId = 'web-frontend'; }
      if (mode === 'skill') { current.question.skillId = selected.question.skillId = 'foreign-skill'; current.plan.skillId = selected.plan.skillId = 'foreign-skill'; }
      if (mode === 'rubric') current.rubric.id = selected.rubric.id = 'foreign-rubric';
      expect(() => f.store.prepare(task, run, Date.now())).toThrow('COMMIT_TRANSITION_INVALID');
    }
  } finally { f.runtime.dispose(); }
});
