import { createRunManager, type AgentRunManager } from '../../apps/agent/src/runtime/run-manager.ts';
import { createPiEvaluator } from '../../apps/agent/src/adapters/pi/evaluator.ts';
import { createEvaluationFixture } from '../../experiments/pi-sdk/evaluation-fixture.ts';
import { reliabilityRequest, assessment, deferred, until } from './fixture.ts';
export const caseIds = ['parallel_isolation', 'cancel_late_capacity', 'timeout_late_capacity', 'subscriber_disconnect', 'sdk_cancel', 'dispose_restart'] as const;
export type CaseId = typeof caseIds[number];
export const checkLabels: Record<CaseId, readonly string[]> = {
  parallel_isolation: ['four-overlap', 'results-isolated', 'events-isolated', 'overflow-rejected', 'no-resources'],
  cancel_late_capacity: ['terminal-without-result', 'dependency-slot-held', 'late-result-rejected', 'readmission-after-settlement', 'no-resources'],
  timeout_late_capacity: ['terminal-without-result', 'dependency-slot-held', 'late-result-rejected', 'readmission-after-settlement', 'no-resources'],
  subscriber_disconnect: ['subscriber-registered', 'disconnect-does-not-cancel', 'replay-ordered', 'no-resources'],
  sdk_cancel: ['provider-entered', 'sdk-abort-observed', 'terminal-without-result', 'no-resources'],
  dispose_restart: ['dispose-rejects-start', 'old-run-cancelled', 'new-manager-has-no-history', 'same-id-new-manager-completes', 'no-resources'],
};
export type Metrics = { peakDependencies: number; remainingDependencies: number; remainingSlots: number; remainingTimers: number;
  remainingSubscribers: number; retainedRuns: number; providerCalls: number; providerAborts: number };
export type ScenarioObservation = { checks: boolean[]; metrics: Metrics };
const metrics = (m: AgentRunManager, peakDependencies: number, providerCalls = 0, providerAborts = 0): Metrics => {
  const d = m.diagnostics(); return { peakDependencies, remainingDependencies: d.inFlightDependencies, remainingSlots: d.occupiedSlots,
    remainingTimers: d.deadlineTimers, remainingSubscribers: d.eventSubscribers, retainedRuns: d.retainedRuns, providerCalls, providerAborts };
};
const clean = (m: AgentRunManager) => { const d = m.diagnostics(); return !d.inFlightDependencies && !d.occupiedSlots && !d.deadlineTimers && !d.eventSubscribers; };
const rateLimited = (call: () => unknown) => { try { call(); return false; } catch (e) { return e instanceof Error && e.message === 'RATE_LIMITED'; } };
export async function runReliabilityScenario(id: CaseId): Promise<ScenarioObservation> {
  if (id === 'parallel_isolation') {
    const markers = ['隔离甲一', '隔离乙二', '隔离丙三', '隔离丁四'];
    const gates = markers.map(() => deferred<void>()); let entered = 0, peak = 0, historyIsolated = true;
    const f = await createEvaluationFixture(async context => {
      const users = context.messages.filter(message => message.role === 'user');
      const content = users[0]?.content;
      const text = typeof content === 'string' ? content : content?.filter(c => c.type === 'text').map(c => c.text).join('');
      const input = JSON.parse(text ?? '{}'), index = markers.indexOf(input.interview?.answer?.text);
      const role = index % 2 ? 'web-frontend' : 'java-backend';
      historyIsolated &&= users.length === 1 && !context.messages.some(message => message.role === 'assistant');
      if (index < 0 || input.interview.roleId !== role || input.rubric.roleId !== role) throw new Error('Invalid fixture scope');
      entered++; peak = Math.max(peak, m.diagnostics().inFlightDependencies); await gates[index]!.promise;
      return { text: JSON.stringify(assessment(markers[index]!)) };
    });
    const m = createRunManager({ evaluateForRole: roleId => createPiEvaluator({ cwd: process.cwd(), modelRuntime: f.runtime, model: f.model, roleId }) }, { maxActiveRuns: 4 });
    const requests = markers.map((s, i) => reliabilityRequest(`parallel-${i}`, i % 2 ? 'web-frontend' : 'java-backend', s));
    try {
      for (const r of requests) m.start(r); await until(() => entered === 4);
      const overflow = rateLimited(() => m.start(reliabilityRequest('overflow')));
      for (const i of [3, 1, 2, 0]) { gates[i]!.resolve(); await m.wait(requests[i]!.context.runId); }
      let isolated = true, eventsIsolated = true;
      for (const [i, r] of requests.entries()) {
        const s = m.snapshot(r.context.runId), result = s.result;
        isolated &&= s.status === 'completed' && result?.kind === 'uncommitted-turn-result' && result.proposal.evidence[0]?.excerpt === markers[i]
          && result.proposal.basedOn.sessionId === r.job.input.state.sessionId && result.proposal.nextState.roleId === r.context.roleId;
        const events = []; for await (const event of m.events(r.context.runId)) events.push(event);
        eventsIsolated &&= events.every((e, j) => e.runId === r.context.runId && e.attemptId === r.context.attemptId && e.seq === j + 1)
          && events.at(-1)?.type === 'run.completed';
      }
      await until(() => clean(m)); return { checks: [peak === 4 && f.stats.providerCalls === 4, isolated && historyIsolated && f.stats.liveModelCalls === 0, eventsIsolated, overflow, clean(m)], metrics: metrics(m, peak, f.stats.providerCalls) };
    } finally { for (const gate of gates) gate.resolve(); m.dispose(); }
  }
  if (id === 'cancel_late_capacity' || id === 'timeout_late_capacity') {
    const gate = deferred<void>(); let entered = 0;
    const m = createRunManager({ evaluateForRole: () => async () => { entered++; if (entered === 1) await gate.promise; return assessment('隔离甲一'); } },
      { maxActiveRuns: 1, timeoutMs: id === 'timeout_late_capacity' ? 200 : 3000 });
    const r = reliabilityRequest(id);
    try {
      m.start(r); await until(() => entered === 1);
      if (id === 'cancel_late_capacity') m.cancel(r.context.runId, r.context.attemptId);
      await m.wait(r.context.runId);
      const stopped = m.snapshot(r.context.runId), terminal = stopped.result === null && stopped.error?.code === (id === 'cancel_late_capacity' ? 'RUN_CANCELLED' : 'DEADLINE_EXCEEDED');
      const held = m.diagnostics().inFlightDependencies === 1 && m.diagnostics().occupiedSlots === 1 && rateLimited(() => m.start(reliabilityRequest('blocked')));
      gate.resolve(); await until(() => clean(m));
      const lateRejected = m.snapshot(r.context.runId).result === null;
      m.start(reliabilityRequest('after-settlement')); await m.wait('after-settlement'); await until(() => clean(m));
      return { checks: [terminal, held, lateRejected, m.snapshot('after-settlement').status === 'completed', clean(m)], metrics: metrics(m, 1) };
    } finally { gate.resolve(); m.dispose(); }
  }
  if (id === 'subscriber_disconnect') {
    const gate = deferred<void>(); let entered = false;
    const m = createRunManager({ evaluateForRole: () => async () => { entered = true; await gate.promise; return assessment('隔离甲一'); } });
    const c = new AbortController(); m.start(reliabilityRequest(id)); const it = m.events(id, 0, c.signal);
    try {
      const first = await it.next(); await until(() => entered); const subscribed = m.diagnostics().eventSubscribers === 1;
      c.abort(); await it.return(undefined); const disconnected = m.diagnostics().eventSubscribers === 0 && m.snapshot(id).status === 'running';
      gate.resolve(); await m.wait(id); const seqs: number[] = [];
      for await (const e of m.events(id, first.value!.seq)) seqs.push(e.seq);
      await until(() => clean(m));
      return { checks: [subscribed, disconnected && m.snapshot(id).status === 'completed', seqs.length > 0 && seqs.every((n, i) => n === first.value!.seq + i + 1), clean(m)], metrics: metrics(m, 1) };
    } finally { c.abort(); await it.return(undefined); gate.resolve(); m.dispose(); }
  }
  if (id === 'sdk_cancel') {
    let entered = false; const handlerDone = deferred<void>();
    const f = await createEvaluationFixture(async (_context, signal) => {
      entered = true;
      await new Promise<void>(resolve => { if (signal?.aborted) resolve(); else signal?.addEventListener('abort', () => resolve(), { once: true }); });
      handlerDone.resolve(); return { text: JSON.stringify(assessment('隔离甲一')) };
    });
    const evaluate = createPiEvaluator({ cwd: process.cwd(), modelRuntime: f.runtime, model: f.model, roleId: 'java-backend', timeoutMs: 3000 });
    const m = createRunManager({ evaluateForRole: () => evaluate });
    try {
      m.start(reliabilityRequest(id)); await until(() => entered); m.cancel(id, 'attempt-1'); await m.wait(id);
      await until(() => clean(m) && f.stats.aborted === 1); await handlerDone.promise;
      return { checks: [f.stats.providerCalls === 1, f.stats.aborted === 1 && f.stats.liveModelCalls === 0,
        m.snapshot(id).status === 'cancelled' && m.snapshot(id).result === null, clean(m)], metrics: metrics(m, 1, f.stats.providerCalls, f.stats.aborted) };
    } finally { m.dispose(); }
  }
  const gate = deferred<void>(); let entered = false;
  const m = createRunManager({ evaluateForRole: () => async () => { entered = true; await gate.promise; return assessment('隔离甲一'); } });
  const fresh = createRunManager({ evaluateForRole: () => async () => assessment('隔离甲一') });
  try {
    m.start(reliabilityRequest(id)); await until(() => entered); m.dispose(); await m.wait(id);
    let rejects = false, missing = false;
    try { m.start(reliabilityRequest('after-dispose')); } catch (e) { rejects = e instanceof Error && e.message === 'DEPENDENCY_UNAVAILABLE'; }
    try { fresh.snapshot(id); } catch (e) { missing = e instanceof Error && e.message === 'NOT_FOUND'; }
    gate.resolve(); await until(() => clean(m)); fresh.start(reliabilityRequest(id)); await fresh.wait(id); await until(() => clean(fresh));
    return { checks: [rejects, m.snapshot(id).status === 'cancelled', missing, fresh.snapshot(id).status === 'completed', clean(m) && clean(fresh)], metrics: metrics(fresh, 1) };
  } finally { gate.resolve(); m.dispose(); fresh.dispose(); }
}
