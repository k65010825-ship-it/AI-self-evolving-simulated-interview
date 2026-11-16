import { createHash } from 'node:crypto';
import { ModelAccessProfileSchema, ModelBudgetScopeSchema, ModelBudgetSnapshotSchema, ModelUsageSchema, PlannedTokensSchema,
  type ModelBudgetEntry, type ModelAccessErrorCode } from '../../../../packages/contracts/src/model-access.ts';
import type{z}from'zod';
import { ModelAccessError, estimateCostMicros } from './preflight.ts';
function fail(code: ModelAccessErrorCode): never { throw new ModelAccessError(code); }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Single process/instance accounting. No persistence, cross-instance quota or vendor billing guarantee. */
export function createModelBudgetGate(rawProfile: unknown, rawScope: unknown, options: { now?: () => number;allowLive?:boolean;
 restore?:unknown;onCheckpoint?:(snapshot:z.infer<typeof ModelBudgetSnapshotSchema>)=>void } = {}) {
  const profile = ModelAccessProfileSchema.safeParse(rawProfile), scope = ModelBudgetScopeSchema.safeParse(rawScope);
  if (!profile.success || !scope.success || (options.now !== undefined && typeof options.now !== 'function')) fail('MODEL_CONFIG_INVALID');
  const config = profile.data, owner = scope.data, clock = options.now ?? Date.now, entries = new Map<string, ModelBudgetEntry>();
  const liveAllowed=options.allowLive===true;
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
      if (e.status === 'reserved' || e.status === 'dispatched' || e.status === 'unknown'||e.status==='rejected') {
        if(e.status!=='rejected')result.activeSlots++;
        result.heldTokens += e.planned.inputTokens + e.planned.outputTokens; result.heldCostMicros += e.reservedCostMicros;
      } else if (e.status === 'settled') {
        result.usedTokens += e.usage!.inputTokens + e.usage!.outputTokens; result.usedCostMicros += e.actualCostMicros!;
      }
    }
    return result;
  };
  const snapshot = () => ModelBudgetSnapshotSchema.parse({ version, profileDigest,currency:config.pricing.currency, scope: owner, mode: config.mode, locked,
    accounting: 'in-memory-declared-rate-not-vendor-billing', entries: [...entries.values()], totals: totals() });
  const checkpoint=()=>{const s=snapshot();options.onCheckpoint?.(structuredClone(s));return s;};
  if(options.restore!==undefined){
    const p=ModelBudgetSnapshotSchema.safeParse(options.restore);if(!p.success)fail('MODEL_STATE_CONFLICT');const s=p.data;
    if(s.profileDigest!==profileDigest||!same(s.scope,owner)||s.mode!==config.mode||s.currency!==config.pricing.currency||s.entries.length>config.limits.maxCalls)fail('MODEL_STATE_CONFLICT');
    for(const e of s.entries){
      if(entries.has(e.callId)||e.planned.inputTokens>config.limits.maxInputTokens||e.planned.outputTokens>config.limits.maxOutputTokens||
        e.reservedCostMicros!==estimateCostMicros(config.pricing.rates,e.planned.inputTokens,e.planned.outputTokens))fail('MODEL_STATE_CONFLICT');
      if(e.status==='settled'){
        if(!e.usage)fail('MODEL_STATE_CONFLICT');const actual=Math.max(estimateCostMicros(config.pricing.rates,e.usage.inputTokens,e.usage.outputTokens),e.usage.reportedCostMicros??0);
        if(e.actualCostMicros!==actual||e.overrun!==(e.usage.inputTokens>e.planned.inputTokens||e.usage.outputTokens>e.planned.outputTokens||actual>e.reservedCostMicros))fail('MODEL_STATE_CONFLICT');
      }else if(e.usage!==undefined||e.actualCostMicros!==undefined||e.overrun)fail('MODEL_STATE_CONFLICT');
      if(e.status==='rejected'&&e.rejectionStatus===undefined)fail('MODEL_STATE_CONFLICT');entries.set(e.callId,structuredClone(e));
    }
    version=s.version;locked=s.locked;
    if(!same(totals(),s.totals)||locked!==s.entries.some(e=>e.overrun))fail('MODEL_STATE_CONFLICT');
  }
  const reserve = (callId: string, rawPlanned: unknown) => {
    time(true);
    if (config.mode !== 'offline-fixture'&&!(config.mode==='live-service'&&liveAllowed)) fail('MODEL_LIVE_DISABLED');
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
    return checkpoint();
  };
  const dispatch = (callId: string) => {
    time(true);
    if (config.mode !== 'offline-fixture'&&!(config.mode==='live-service'&&liveAllowed)) fail('MODEL_LIVE_DISABLED');
    if (locked) fail('MODEL_BUDGET_LOCKED');
    const e = find(callId); if (e.status !== 'reserved') fail('MODEL_STATE_CONFLICT');
    e.status = 'dispatched'; version++; return checkpoint();
  };
  const release = (callId: string) => {
    time(); const e = find(callId); if (e.status !== 'reserved') fail('MODEL_STATE_CONFLICT');
    e.status = 'released'; version++; return checkpoint();
  };
  const markUnknown = (callId: string) => {
    time(); const e = find(callId);
    if (e.status === 'unknown') return snapshot();
    if (e.status !== 'dispatched') fail('MODEL_STATE_CONFLICT');
    e.status = 'unknown'; version++; return checkpoint();
  };
  const settle = (callId: string, rawUsage: unknown) => {
    time(); const e = find(callId), parsed = ModelUsageSchema.safeParse(rawUsage); if (!parsed.success) fail('MODEL_USAGE_INVALID');
    const usage = parsed.data;
    if (e.status === 'settled') { if (!same(e.usage, usage)) fail('MODEL_STATE_CONFLICT'); return snapshot(); }
    if (e.status !== 'dispatched' && e.status !== 'unknown'&&e.status!=='rejected') fail('MODEL_STATE_CONFLICT');
    const actualCost = Math.max(estimateCostMicros(config.pricing.rates, usage.inputTokens, usage.outputTokens), usage.reportedCostMicros ?? 0);
    const overrun = usage.inputTokens > e.planned.inputTokens || usage.outputTokens > e.planned.outputTokens || actualCost > e.reservedCostMicros;
    // Record the full observed overrun before blocking later work. Never clip it to the budget.
    e.usage = usage; e.actualCostMicros = actualCost; e.overrun = overrun; e.status = 'settled'; locked ||= overrun; version++;
    return checkpoint();
  };
  const rejectHttp=(callId:string,status:400|413|429|503)=>{
    time();if(![400,413,429,503].includes(status))fail('MODEL_STATE_CONFLICT');const e=find(callId);
    if(e.status!=='dispatched')fail('MODEL_STATE_CONFLICT');
    e.status='rejected';e.rejectionStatus=status;version++;return checkpoint();
  };
  return { reserve, dispatch, release, markUnknown, rejectHttp, settle, snapshot, remainingMs: () => Math.max(0, owner.deadlineAt - time()),
    // Fresh copies; mutating these cannot change the captured host configuration.
    profile: () => ModelAccessProfileSchema.parse(config) };
}
export type ModelBudgetGate = ReturnType<typeof createModelBudgetGate>;
