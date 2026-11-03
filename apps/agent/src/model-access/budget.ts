import { createHash } from 'node:crypto';
import { ModelAccessProfileSchema, ModelBudgetScopeSchema, ModelBudgetSnapshotSchema, ModelUsageSchema, PlannedTokensSchema,
  type ModelBudgetEntry, type ModelAccessErrorCode } from '../../../../packages/contracts/src/model-access.ts';
import { ModelAccessError, estimateCostMicros } from './preflight.ts';
function fail(code: ModelAccessErrorCode): never { throw new ModelAccessError(code); }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Single process/instance accounting. No persistence, cross-instance quota or vendor billing guarantee. */
export function createModelBudgetGate(rawProfile: unknown, rawScope: unknown, options: { now?: () => number } = {}) {
  const profile = ModelAccessProfileSchema.safeParse(rawProfile), scope = ModelBudgetScopeSchema.safeParse(rawScope);
  if (!profile.success || !scope.success || (options.now !== undefined && typeof options.now !== 'function')) fail('MODEL_CONFIG_INVALID');
  const config = profile.data, owner = scope.data, clock = options.now ?? Date.now, entries = new Map<string, ModelBudgetEntry>();
  const profileDigest = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  let version = 0, locked = false, lastTime = -1;
  const time = (requireOpen = false) => {
    let now: number;
    try { now = clock(); } catch { fail('MODEL_CLOCK_INVALID'); }
    if (!Number.isSafeInteger(now) || now < 0 || now < lastTime) fail('MODEL_CLOCK_INVALID');
    lastTime = now;
    if (requireOpen && now >= owner.deadlineAt) fail('MODEL_DEADLINE_EXCEEDED');
    return now;
  };
  time();
  const find = (callId: string) => entries.get(callId) ?? fail('MODEL_STATE_CONFLICT');
  const totals = () => {
    const result = { callsConsumed: entries.size, activeSlots: 0, heldTokens: 0, usedTokens: 0, heldCostMicros: 0, usedCostMicros: 0 };
    for (const e of entries.values()) {
      if (e.status === 'reserved' || e.status === 'dispatched' || e.status === 'unknown') {
        result.activeSlots++; result.heldTokens += e.planned.inputTokens + e.planned.outputTokens; result.heldCostMicros += e.reservedCostMicros;
      } else if (e.status === 'settled') {
        result.usedTokens += e.usage!.inputTokens + e.usage!.outputTokens; result.usedCostMicros += e.actualCostMicros!;
      }
    }
    return result;
  };
  const snapshot = () => ModelBudgetSnapshotSchema.parse({ version, profileDigest, scope: owner, mode: config.mode, locked,
    accounting: 'in-memory-declared-rate-not-vendor-billing', entries: [...entries.values()], totals: totals() });
  const reserve = (callId: string, rawPlanned: unknown) => {
    time(true);
    if (config.mode !== 'offline-fixture') fail('MODEL_LIVE_DISABLED');
    if (locked) fail('MODEL_BUDGET_LOCKED');
    if (typeof callId !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(callId)) fail('MODEL_CONFIG_INVALID');
    if (entries.has(callId)) fail('MODEL_CALL_ID_REUSED');
    const planned = PlannedTokensSchema.safeParse(rawPlanned); if (!planned.success) fail('MODEL_CONFIG_INVALID');
    const p = planned.data, t = totals(), limits = config.limits;
    if (p.inputTokens > limits.maxInputTokens || p.outputTokens > limits.maxOutputTokens ||
      t.usedTokens + t.heldTokens + p.inputTokens + p.outputTokens > limits.maxTotalTokens) fail('MODEL_TOKEN_BUDGET_EXCEEDED');
    if (t.callsConsumed >= limits.maxCalls) fail('MODEL_CALL_BUDGET_EXCEEDED');
    if (t.activeSlots >= limits.maxConcurrent) fail('MODEL_CONCURRENCY_EXCEEDED');
    const cost = estimateCostMicros(config.pricing.rates, p.inputTokens, p.outputTokens);
    if (t.usedCostMicros + t.heldCostMicros + cost > limits.maxCostMicros) fail('MODEL_COST_BUDGET_EXCEEDED');
    entries.set(callId, { callId, status: 'reserved', planned: p, reservedCostMicros: cost, overrun: false }); version++;
    return snapshot();
  };
  const dispatch = (callId: string) => {
    time(true);
    if (config.mode !== 'offline-fixture') fail('MODEL_LIVE_DISABLED');
    if (locked) fail('MODEL_BUDGET_LOCKED');
    const e = find(callId); if (e.status !== 'reserved') fail('MODEL_STATE_CONFLICT');
    e.status = 'dispatched'; version++; return snapshot();
  };
  const release = (callId: string) => {
    time(); const e = find(callId); if (e.status !== 'reserved') fail('MODEL_STATE_CONFLICT');
    e.status = 'released'; version++; return snapshot();
  };
  const markUnknown = (callId: string) => {
    time(); const e = find(callId);
    if (e.status === 'unknown') return snapshot();
    if (e.status !== 'dispatched') fail('MODEL_STATE_CONFLICT');
    e.status = 'unknown'; version++; return snapshot();
  };
  const settle = (callId: string, rawUsage: unknown) => {
    time(); const e = find(callId), parsed = ModelUsageSchema.safeParse(rawUsage); if (!parsed.success) fail('MODEL_USAGE_INVALID');
    const usage = parsed.data;
    if (e.status === 'settled') { if (!same(e.usage, usage)) fail('MODEL_STATE_CONFLICT'); return snapshot(); }
    if (e.status !== 'dispatched' && e.status !== 'unknown') fail('MODEL_STATE_CONFLICT');
    const actualCost = Math.max(estimateCostMicros(config.pricing.rates, usage.inputTokens, usage.outputTokens), usage.reportedCostMicros ?? 0);
    const overrun = usage.inputTokens > e.planned.inputTokens || usage.outputTokens > e.planned.outputTokens || actualCost > e.reservedCostMicros;
    // Record the full observed overrun before blocking later work. Never clip it to the budget.
    e.usage = usage; e.actualCostMicros = actualCost; e.overrun = overrun; e.status = 'settled'; locked ||= overrun; version++;
    return snapshot();
  };
  return { reserve, dispatch, release, markUnknown, settle, snapshot, remainingMs: () => Math.max(0, owner.deadlineAt - time()),
    // Fresh copies; mutating these cannot change the captured host configuration.
    profile: () => ModelAccessProfileSchema.parse(config) };
}
export type ModelBudgetGate = ReturnType<typeof createModelBudgetGate>;
