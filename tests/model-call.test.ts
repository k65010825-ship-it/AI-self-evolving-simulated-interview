import { test, expect } from 'bun:test';
import offline from '../apps/agent/src/model-access/offline.profile.json' with { type: 'json' };
import planned from '../apps/agent/src/model-access/live-planned.example.json' with { type: 'json' };
import { createModelBudgetGate } from '../apps/agent/src/model-access/budget.ts';
import { runBudgetedFixtureCall } from '../apps/agent/src/model-access/execute.ts';
import { ModelAccessError } from '../apps/agent/src/model-access/preflight.ts';

const scope = () => ({ budgetId: 'budget', userId: 'fixture', roleId: 'java-backend', runId: 'run', attemptId: 'a', deadlineAt: Date.now() + 60000 });
function fixture() {
  const identity = scope(), gate = createModelBudgetGate(offline, identity);
  return { gate, request: { scope: identity, callId: 'call', payload: 'fixture prompt', planned: { inputTokens: 100, outputTokens: 40 } } };
}
const good = { text: 'fixed local response', usage: { inputTokens: 50, outputTokens: 10, complete: true } };
test('successful fixture call reserves before dispatch, passes explicit bounds, and settles reported usage', async () => {
  const { gate, request } = fixture(); let calls = 0;
  const text = await runBudgetedFixtureCall(gate, request, async (_payload, limits) => { calls++; expect(limits.maxOutputTokens).toBe(40); return good; });
  expect(text).toBe(good.text); expect(calls).toBe(1);
  expect(gate.snapshot().totals.usedTokens).toBe(60);
  await expect(runBudgetedFixtureCall(gate, request, async () => { calls++; return good; })).rejects.toThrow('MODEL_CALL_ID_REUSED');
  expect(calls).toBe(1);
});
test('wrong identity, pre-cancel, oversized payload and live config reject without invoking a dependency', async () => {
  const { gate, request } = fixture(); let calls = 0; const invoke = async () => { calls++; return good; };
  await expect(runBudgetedFixtureCall(gate, { ...request, scope: { ...request.scope, userId: 'other' } }, invoke)).rejects.toThrow('MODEL_STATE_CONFLICT');
  const controller = new AbortController(); controller.abort();
  await expect(runBudgetedFixtureCall(gate, { ...request, signal: controller.signal }, invoke)).rejects.toThrow('MODEL_CANCELLED');
  await expect(runBudgetedFixtureCall(gate, { ...request, payload: 'x'.repeat(12001) }, invoke)).rejects.toThrow('MODEL_INPUT_LIMIT_EXCEEDED');
  const live = createModelBudgetGate(planned, request.scope);
  await expect(runBudgetedFixtureCall(live, request, invoke)).rejects.toThrow('MODEL_LIVE_DISABLED');
  expect(calls).toBe(0); expect(gate.snapshot().totals.callsConsumed).toBe(0);
});
test('missing usage and raw provider errors leave conservative unknown holds without leaking errors', async () => {
  for (const invoke of [async () => { throw new Error('SECRET_UPSTREAM'); }, async () => ({ text: 'response without usage' })]) {
    const { gate, request } = fixture();
    try { await runBudgetedFixtureCall(gate, request, invoke); throw new Error('unexpected success'); }
    catch (e) { expect((e as Error).message).not.toContain('SECRET_UPSTREAM'); }
    expect(gate.snapshot().entries[0]!.status).toBe('unknown'); expect(gate.snapshot().totals.heldTokens).toBe(140);
  }
});
test('timeout and cancellation win over late valid results, preserving unknown holds for explicit reconciliation', async () => {
  const identity = scope(), gate = createModelBudgetGate({ ...offline, limits: { ...offline.limits, timeoutMs: 5 } }, identity);
  let resolve!: (v: unknown) => void;
  const pending = new Promise(r => { resolve = r; });
  await expect(runBudgetedFixtureCall(gate, { scope: identity, callId: 'hung', payload: 'x', planned: { inputTokens: 100, outputTokens: 40 } }, async () => pending)).rejects.toThrow('MODEL_DEADLINE_EXCEEDED');
  resolve(good); await pending;
  expect(gate.snapshot().entries[0]!.status).toBe('unknown'); expect(gate.snapshot().totals.usedTokens).toBe(0);
  expect(gate.settle('hung', good.usage).totals.usedTokens).toBe(60);
  const f = fixture(), controller = new AbortController();
  await expect(runBudgetedFixtureCall(f.gate, { ...f.request, signal: controller.signal }, async () => { controller.abort(); return good; })).rejects.toThrow('MODEL_CANCELLED');
  expect(f.gate.snapshot().entries[0]!.status).toBe('unknown');
});
test('usage overrun is fully accounted and oversized output is rejected even with valid usage', async () => {
  const f = fixture();
  await expect(runBudgetedFixtureCall(f.gate, f.request, async () => ({ text: 'x', usage: { inputTokens: 200, outputTokens: 1, complete: true } }))).rejects.toThrow('MODEL_USAGE_OVERRUN');
  expect(f.gate.snapshot().locked).toBe(true); expect(f.gate.snapshot().totals.usedTokens).toBe(201);
  const g = fixture();
  await expect(runBudgetedFixtureCall(g.gate, g.request, async () => ({ text: 'x'.repeat(4001), usage: good.usage }))).rejects.toThrow('MODEL_OUTPUT_LIMIT_EXCEEDED');
  expect(g.gate.snapshot().entries[0]!.status).toBe('settled');
});

test('a dependency cannot leak a rewritten error message by throwing the host error class', async () => {
  const f = fixture(), upstream = new ModelAccessError('MODEL_COST_BUDGET_EXCEEDED'); upstream.message = 'SECRET_UPSTREAM_REWRITTEN';
  try { await runBudgetedFixtureCall(f.gate, f.request, async () => { throw upstream; }); throw new Error('unexpected success'); }
  catch (e) {
    expect((e as Error).message).toBe('MODEL_DEPENDENCY_FAILED');
    expect(e).not.toBe(upstream);
  }
  expect(f.gate.snapshot().entries[0]!.status).toBe('unknown');
});

test('synchronous dependency work cannot return success after the timer was delayed past its deadline', async () => {
  const identity = scope(), gate = createModelBudgetGate({ ...offline, limits: { ...offline.limits, timeoutMs: 5 } }, identity);
  await expect(runBudgetedFixtureCall(gate, { scope: identity, callId: 'cpu', payload: 'x', planned: { inputTokens: 100, outputTokens: 40 } },
    async () => { const start = performance.now(); while (performance.now() - start < 15) { /* simulate synchronous work */ } return good; })).rejects.toThrow('MODEL_DEADLINE_EXCEEDED');
});
