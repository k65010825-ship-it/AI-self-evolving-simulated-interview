import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createAgentClient, WorkflowCommitError } from '@interview/agent-client';
import { createAgentApp } from '../apps/agent/src/app.ts';
import { createOfflineRunManager } from '../apps/agent/src/runtime/offline-runtime.ts';
import { createMemory } from '../apps/agent/src/memory/session-memory.ts';
import { createWorkflowCommitFixtureStore } from '../experiments/commit/fixture-store.ts';
import type { WorkflowOperation } from '../packages/contracts/src/workflow-job.ts';
import type { RoleId, ToolContext } from '../packages/contracts/src/tools.ts';
import type { AgentRunRequest } from '../packages/contracts/src/agent-run.ts';

export async function runWorkflowCommitDemo(roleId: RoleId = 'java-backend', transport: 'tcp' | 'in-process' = 'tcp') {
  const now = Date.now(), identity = { userId: 'backend-fixture', roleId }, memory = createMemory(identity, now), sessionId = `commit-demo-${roleId}`;
  const store = createWorkflowCommitFixtureStore({ identity, sessionId, memory }), runtime = await createOfflineRunManager({ planning: 'pi-knowledge' });
  const token = randomBytes(32).toString('hex'); let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    const app = createAgentApp({ runtime, internalToken: token });
    if (transport === 'tcp') server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
    const client = createAgentClient({ baseUrl: server ? `http://127.0.0.1:${server.port}` : 'http://agent.local', internalToken: token,
      fetch: async (url, init) => server ? fetch(url, init) : app.request(new Request(url, init)) });
    let index = 0, eventCount = 0;
    const actions: string[] = [], revisionHistory: number[] = [], storageVersionHistory: number[] = [];
    async function prepare(build: (context: ToolContext) => WorkflowOperation) {
      const name = `commit-${++index}`, context = { ...identity, runId: name, attemptId: 'a', deadlineAt: Date.now() + 60000 };
      const operation = build(context), request: AgentRunRequest = { inputSnapshotId: name, context, job: { type: 'workflow', operation } };
      const taskId = store.stage(request, { operationId: name, taskId: name, now: Date.now(), leaseMs: 30000 });
      await client.startRun(request);
      for await (const e of client.events(context.runId, { attemptId: context.attemptId })) {
        eventCount++; if (e.type === 'run.completed' && e.payload.committed !== false) throw new Error('Unexpected formal commit event');
      }
      const run = await client.getRun(context.runId, { attemptId: context.attemptId }), decision = store.prepare(taskId, run, Date.now());
      return { taskId, run, decision, action: operation.action };
    }
    function apply(p: Awaited<ReturnType<typeof prepare>>) {
      const result = store.apply(p.decision, Date.now());
      if (result.effect !== 'applied-in-memory') throw new Error('Expected new fixture operation');
      const row = store.current().session!; actions.push(p.action); revisionHistory.push(row.workflow.revision); storageVersionHistory.push(row.storageVersion);
    }
    const created = await prepare(() => ({ action: 'create', config: { identity, session: { sessionId, roleId, durationMinutes: 20,
      skills: [{ skillId: 'project-design', relevance: 1 }, { skillId: 'collaboration', relevance: .99 }] }, memory,
      policy: { id: 'commit-policy', roleId, parameters: { maxFollowupDepth: 0, maxTurns: 2, wrapUpSeconds: 30 } },
      goal: '后端提交离线联调', skillLabels: { 'project-design': '项目', collaboration: '沟通' }, allowDraftKnowledge: true, now } }));
    apply(created);
    const start = store.current().session!.workflow;
    const plan = (context: ToolContext): WorkflowOperation => ({ action: 'plan', snapshot: start, command: { identity, expectedRevision: start.revision, context } });
    const [winner, loser] = await Promise.all([prepare(plan), prepare(plan)]);
    apply(winner); let raceError = '';
    try { store.apply(loser.decision, Date.now()); } catch (e) { if (!(e instanceof WorkflowCommitError)) throw e; raceError = e.code; }
    if (raceError !== 'COMMIT_VERSION_CONFLICT') throw new Error('Expected one CAS loser');
    for (let i = 0; i < 2; i++) {
      let snapshot = store.current().session!.workflow;
      if (i) { apply(await prepare(context => ({ action: 'plan', snapshot, command: { identity, expectedRevision: snapshot.revision, context } }))); snapshot = store.current().session!.workflow; }
      apply(await prepare(context => ({ action: 'answer', snapshot, command: { identity, expectedRevision: snapshot.revision, context,
        observationId: `observation-${i}`, answer: { id: `answer-${i}`, text: '以下是明确的假设案例：先确认约束和个人动作，再说明验证；尚未验证线上效果。' }, quality: .8, evidenceMode: 'offline-fixture' } })));
    }
    let snapshot = store.current().session!.workflow;
    const command = { identity, expectedRevision: snapshot.revision, mode: 'automatic' as const, sourceGroupId: `commit-fixture-${roleId}` };
    apply(await prepare(() => ({ action: 'finish', snapshot, command })));
    snapshot = store.current().session!.workflow;
    apply(await prepare(() => ({ action: 'finish', snapshot, command })));
    snapshot = store.current().session!.workflow;
    apply(await prepare(() => ({ action: 'restore', snapshot })));
    const replay = store.prepare(created.taskId, created.run, Date.now());
    const acknowledged = store.apply(replay, Date.now()), state = store.current();
    return { roleId, transport, actions, revisionHistory, storageVersionHistory, raceError, lostAck: acknowledged.effect,
      receiptCount: store.receiptCount(), memoryVersion: state.memory.version, phase: state.session!.workflow.phase, eventCount,
      scope: 'offline-cas-fixture', formalCommitted: false, liveModelCalls: 0 };
  } finally { runtime.dispose(); await server?.stop(true); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { for (const role of ['java-backend', 'web-frontend'] as const) console.log(JSON.stringify(await runWorkflowCommitDemo(role))); }
  catch { console.error('WORKFLOW_COMMIT_DEMO_FAILED'); process.exitCode = 1; }
}
