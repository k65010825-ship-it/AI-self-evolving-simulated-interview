import { commitSource } from './commit-source.ts';
import { createWorkflowCommitFixtureStore } from '../../experiments/commit/fixture-store.ts';
import type { WorkflowOperation } from '../../packages/contracts/src/workflow-job.ts';
import type { ToolContext } from '../../packages/contracts/src/tools.ts';
import type { AgentRunRequest } from '../../packages/contracts/src/agent-run.ts';

export async function finishCommitFixture() {
  const f = await commitSource(), store = createWorkflowCommitFixtureStore({ identity: f.identity, sessionId: f.ticket.sessionId, memory: f.current.memory });
  let index = 0;
  const invoke = async (build: (context: ToolContext) => WorkflowOperation, apply = true) => {
    const name = `step-${++index}`, context = { ...f.request.context, runId: name, deadlineAt: Date.now() + 60000 };
    const request: AgentRunRequest = { inputSnapshotId: name, context, job: { type: 'workflow', operation: build(context) } };
    const taskId = store.stage(request, { operationId: name, taskId: name, now: Date.now(), leaseMs: 30000 });
    const run = await f.execute(request), plan = store.prepare(taskId, run, Date.now());
    if (apply) store.apply(plan, Date.now());
    return { request, taskId, run, plan };
  };
  const createTask = store.stage(f.request, { operationId: 'create', taskId: 'create', now: Date.now(), leaseMs: 30000 });
  store.apply(store.prepare(createTask, f.run, Date.now()), Date.now());
  for (let i = 0; i < 2; i++) {
    let snapshot = store.current().session!.workflow;
    await invoke(context => ({ action: 'plan', snapshot, command: { identity: f.identity, expectedRevision: snapshot.revision, context } }));
    snapshot = store.current().session!.workflow;
    await invoke(context => ({ action: 'answer', snapshot, command: { identity: f.identity, expectedRevision: snapshot.revision, context,
      observationId: `observation-${i}`, answer: { id: `answer-${i}`, text: '这是明确的假设案例，我先确认约束、动作及测试，尚未验证线上效果。' }, quality: .8, evidenceMode: 'offline-fixture' } }));
  }
  const snapshot = store.current().session!.workflow;
  const finish = await invoke(() => ({ action: 'finish', snapshot, command: { identity: f.identity, expectedRevision: snapshot.revision,
    mode: 'automatic', sourceGroupId: 'commit-source-group' } }), false);
  return { ...f, store, finish, invoke };
}
