import { test, expect } from 'bun:test';
import offline from '../apps/agent/src/model-access/offline.profile.json' with { type: 'json' };
import planned from '../apps/agent/src/model-access/live-planned.example.json' with { type: 'json' };
import { createModelBudgetGate } from '../apps/agent/src/model-access/budget.ts';

const scope = { budgetId: 'budget-fixture', userId: 'fixture-user', roleId: 'java-backend', runId: 'run', attemptId: 'a', deadlineAt: 10000 };
const usage = { inputTokens: 50, outputTokens: 10, complete: true };
function fixture(overrides: Record<string, unknown> = {}) {
  return createModelBudgetGate({ ...offline, limits: { ...offline.limits, ...overrides } }, scope, { now: () => 100 });
}
test('reservation consumes concurrency atomically and duplicates cannot cause a second dispatch', () => {
  const gate = fixture(); gate.reserve('a', { inputTokens: 100, outputTokens: 40 });
  expect(() => gate.reserve('b', { inputTokens: 100, outputTokens: 40 })).toThrow('MODEL_CONCURRENCY_EXCEEDED');
  expect(() => gate.reserve('a', { inputTokens: 100, outputTokens: 40 })).toThrow('MODEL_CALL_ID_REUSED');
  gate.dispatch('a'); expect(() => gate.dispatch('a')).toThrow('MODEL_STATE_CONFLICT');
  const first = gate.settle('a', usage), second = gate.settle('a', usage);
  expect(second).toEqual(first);
  expect(() => gate.settle('a', { ...usage, inputTokens: 51 })).toThrow('MODEL_STATE_CONFLICT');
  gate.reserve('b', { inputTokens: 100, outputTokens: 40 });
  expect(gate.snapshot().totals.callsConsumed).toBe(2);
});
test('unknown usage retains token, cost and concurrency holds; only undispatched work can be released', () => {
  const gate = fixture(); gate.reserve('a', { inputTokens: 100, outputTokens: 40 }); gate.dispatch('a'); gate.markUnknown('a');
  expect(gate.snapshot().totals.heldTokens).toBe(140);
  expect(gate.snapshot().totals.heldCostMicros).toBeGreaterThan(0);
  expect(() => gate.release('a')).toThrow('MODEL_STATE_CONFLICT');
  expect(() => gate.reserve('b', { inputTokens: 1, outputTokens: 1 })).toThrow('MODEL_CONCURRENCY_EXCEEDED');
  gate.settle('a', usage); gate.reserve('b', { inputTokens: 100, outputTokens: 40 }); gate.release('b');
  expect(gate.snapshot().totals.heldTokens).toBe(0); expect(gate.snapshot().totals.callsConsumed).toBe(2);
});
test('token/cost/call limits reject before dispatch, and overruns are recorded without clipping then lock the gate', () => {
  const gate = fixture({ maxTotalTokens: 150 });
  expect(() => gate.reserve('too-big', { inputTokens: 100, outputTokens: 60 })).toThrow('MODEL_TOKEN_BUDGET_EXCEEDED');
  gate.reserve('a', { inputTokens: 100, outputTokens: 40 }); gate.dispatch('a');
  const settled = gate.settle('a', { inputTokens: 200, outputTokens: 10, complete: true });
  expect(settled.locked).toBe(true); expect(settled.totals.usedTokens).toBe(210);
  expect(() => gate.reserve('b', { inputTokens: 1, outputTokens: 1 })).toThrow('MODEL_BUDGET_LOCKED');
  const calls = fixture({ maxCalls: 1 }); calls.reserve('a', { inputTokens: 1, outputTokens: 1 }); calls.release('a');
  expect(() => calls.reserve('b', { inputTokens: 1, outputTokens: 1 })).toThrow('MODEL_CALL_BUDGET_EXCEEDED');
  const cost = fixture({ maxCostMicros: 1 });
  expect(() => cost.reserve('a', { inputTokens: 100, outputTokens: 40 })).toThrow('MODEL_COST_BUDGET_EXCEEDED');
});
test('host scope is copied, late settlements remain possible, and planned live config cannot reserve', () => {
  let now = 100;
  const mutable = { ...scope }, gate = createModelBudgetGate(offline, mutable, { now: () => now });
  mutable.userId = 'changed'; expect(gate.snapshot().scope.userId).toBe('fixture-user');
  gate.reserve('a', { inputTokens: 100, outputTokens: 40 }); gate.dispatch('a'); now = 10001;
  const copy = gate.snapshot(); copy.entries[0]!.planned.inputTokens = 999;
  expect(gate.snapshot().entries[0]!.planned.inputTokens).toBe(100);
  expect(() => gate.reserve('b', { inputTokens: 1, outputTokens: 1 })).toThrow('MODEL_DEADLINE_EXCEEDED');
  expect(gate.settle('a', usage).totals.usedTokens).toBe(60);
  now = 99; expect(() => gate.reserve('b', { inputTokens: 1, outputTokens: 1 })).toThrow('MODEL_CLOCK_INVALID');
  const live = createModelBudgetGate(planned, scope, { now: () => 100 });
  expect(() => live.reserve('a', { inputTokens: 1, outputTokens: 1 })).toThrow('MODEL_LIVE_DISABLED');
});

test('a failed host clock is converted to a static clock error', () => {
  expect(() => createModelBudgetGate(offline, scope, { now: () => { throw new Error('PRIVATE_CLOCK_DETAIL'); } })).toThrow('MODEL_CLOCK_INVALID');
});

test('unknown calls keep their own slot without a global lock, and concurrent overruns remain fully representable', () => {
  const gate = fixture({ maxConcurrent: 2 });
  gate.reserve('a', { inputTokens: 100, outputTokens: 40 }); gate.dispatch('a'); gate.markUnknown('a');
  gate.reserve('b', { inputTokens: 100, outputTokens: 40 }); gate.dispatch('b');
  expect(gate.snapshot().totals.activeSlots).toBe(2); expect(gate.snapshot().locked).toBe(false);
  gate.settle('a', { ...usage, reportedCostMicros: 1_000_000_000_000 });
  const r = gate.settle('b', { ...usage, reportedCostMicros: 1_000_000_000_000 });
  expect(r.totals.usedCostMicros).toBe(2_000_000_000_000); expect(r.locked).toBe(true);
});
