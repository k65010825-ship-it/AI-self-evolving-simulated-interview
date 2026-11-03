import { randomBytes } from 'node:crypto';
import { createAgentClient } from '@interview/agent-client';
import { createAgentApp } from '../../apps/agent/src/app.ts';
import { createRunManager } from '../../apps/agent/src/runtime/run-manager.ts';
import { AgentStateError } from '../../apps/agent/src/planning/interview-state.ts';
import { applyExperimentOperation } from '../../apps/agent/src/reflection/experiment-registry.ts';
import { evaluateWorkflowRsi } from '../../apps/agent/src/reflection/evaluate-workflow-rsi.ts';
import { runWorkflowHttpDemo } from '../../scripts/demo-workflow-http.ts';
import { runWorkflowRsiHttpDemo } from '../../scripts/demo-workflow-rsi-http.ts';
import { runWorkflowRsiDemo } from '../../scripts/demo-workflow-rsi.ts';
import { buildAcceptanceCase, caseIds, roles, expectations, sealAcceptanceReport,
  type AcceptanceCase, type CaseId, type RoleId, type SourceManifest, type Transport } from './report.ts';

type Actual = Record<string, string | number | boolean | null>;
type Executor = (id: CaseId, roleId: RoleId, transport: Transport) => Promise<Actual>;

async function rejectedHttp(id: 'stale' | 'leakage', roleId: RoleId, transport: Transport): Promise<Actual> {
  const d = await runWorkflowRsiDemo(roleId), input = structuredClone(d.input);
  if (id === 'stale') input.expectedRegistryVersion = 99;
  else input.suite.cases[0]!.groupId = d.source.closeout!.sourceGroupId;
  const runtime = createRunManager({ evaluateForRole: () => async () => { throw new Error('Unused evaluator'); } });
  const token = randomBytes(32).toString('hex');
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    const app = createAgentApp({ runtime, internalToken: token });
    if (transport === 'tcp') server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
    const client = createAgentClient({ baseUrl: server ? `http://127.0.0.1:${server.port}` : 'http://agent.local', internalToken: token,
      fetch: async (url, init) => server ? fetch(url, init) : app.request(new Request(url, init)) });
    const runId = `acceptance-${roleId}-${id}`, attemptId = 'a1';
    await client.startRun({ inputSnapshotId: 'acceptance-negative-fixture',
      context: { ...input.identity, runId, attemptId, deadlineAt: Date.now() + 30000 }, job: { type: 'rsi', input } });
    const eventTypes = [];
    for await (const e of client.events(runId, { attemptId })) eventTypes.push(e.type);
    const snapshot = await client.getRun(runId, { attemptId });
    // Unknown outcomes become a failed scenario, never an arbitrary error dump in the artifact.
    if (snapshot.error?.code !== 'VERSION_CONFLICT' && snapshot.error?.code !== 'VALIDATION_ERROR') throw new Error('Unexpected rejection');
    return { status: snapshot.status, code: snapshot.error.code, resultIsNull: snapshot.result === null, noRsiSuccess: !eventTypes.includes('rsi.completed') };
  } finally { runtime.dispose(); await server?.stop(true); }
}

export const executeAcceptanceScenario: Executor = async (id, roleId, transport) => {
  if (id === 'workflow') {
    const d = await runWorkflowHttpDemo(roleId, transport, { sdk: true });
    return { completed: d.phase === 'completed', sdk: d.client === 'sdk', revisions: d.revisionHistory.join(','),
      questionCount: d.questionCount, committed: d.committed, liveModelCalls: d.liveModelCalls };
  }
  if (id === 'rsi') {
    const d = await runWorkflowRsiHttpDemo(roleId, transport);
    if (d.baseline === undefined || d.candidate === undefined) throw new Error('Missing metrics');
    return { status: d.status, baseline: d.baseline, candidate: d.candidate, replayStatus: d.replayStatus,
      version: d.registryVersion, replayVersion: d.replayVersion, oldDepth: d.oldDepth, previewDepth: d.previewDepth,
      productionPublished: d.productionPublished, liveModelCalls: d.liveModelCalls };
  }
  if (id === 'stale' || id === 'leakage') return rejectedHttp(id, roleId, transport);
  const d = await runWorkflowRsiDemo(roleId);
  if (id === 'rollback') {
    const registry = applyExperimentOperation(d.result.registryCandidate, {
      experimentId: d.input.experimentId, roleId, expectedVersion: 1, operationId: 'acceptance-rollback',
      action: 'rollback', targetPolicyId: d.source.policy.id, reason: '离线验收回滚', now: Date.now(),
    });
    // Keep the original operation timestamp: this is the previously repaired retry boundary.
    const r = await evaluateWorkflowRsi({ ...d.input, registry });
    return { status: r.status, activeIsBaseline: r.activeAfter === d.source.policy.id,
      previewIsBaseline: r.nextSessionPin.policy.id === d.source.policy.id, version: r.registryCandidate.version, appliedNow: r.appliedNow };
  }
  const frozen = JSON.stringify(d.input.registry), controller = new AbortController();
  controller.abort();
  try { await evaluateWorkflowRsi(d.input, { signal: controller.signal }); }
  catch (e) {
    if (e instanceof AgentStateError && e.code === 'RUN_CANCELLED') return { code: e.code, registryUnchanged: JSON.stringify(d.input.registry) === frozen };
    throw e;
  }
  throw new Error('Expected pre-cancel rejection');
};

/** Test-only executor seam; CLI always uses the real fixed scenario executor. */
export async function runAcceptanceSuite(input: { transport: Transport; manifest: SourceManifest }, execute: Executor = executeAcceptanceScenario) {
  const startedAt = new Date().toISOString(), cases: AcceptanceCase[] = [];
  for (const roleId of roles) for (const id of caseIds) {
    const started = performance.now(), transport = id === 'rollback' || id === 'cancellation' ? 'host' : input.transport;
    const duration = () => Math.max(0, Math.round(performance.now() - started));
    try {
      const actual = await execute(id, roleId, input.transport);
      cases.push(buildAcceptanceCase({ id, roleId, transport, actual, durationMs: duration() }));
    } catch {
      // Preserve every failed case and continue, but never export raw exceptions or credentials.
      cases.push(buildAcceptanceCase({ id, roleId, transport, durationMs: duration(), error: 'SCENARIO_ERROR',
        actual: Object.fromEntries(Object.keys(expectations[id]).map(k => [k, null])) }));
    }
  }
  return sealAcceptanceReport({ ...input, startedAt, finishedAt: new Date().toISOString(), cases });
}
