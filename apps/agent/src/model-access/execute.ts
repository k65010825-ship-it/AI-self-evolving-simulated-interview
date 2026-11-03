import { z } from 'zod';
import { ModelBudgetScopeSchema, PlannedTokensSchema, ModelAccessErrorSchema } from '../../../../packages/contracts/src/model-access.ts';
import type { ModelBudgetGate } from './budget.ts';
import { ModelAccessError } from './preflight.ts';

const requestSchema = z.object({ scope: ModelBudgetScopeSchema, callId: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  payload: z.string(), planned: PlannedTokensSchema }).strict();
/** Local fixture callback only. No network transport, key resolution or automatic retries is installed here. */
export async function runBudgetedFixtureCall(gate: ModelBudgetGate, input: {
  scope: unknown; callId: string; payload: string; planned: { inputTokens: number; outputTokens: number }; signal?: AbortSignal;
}, invoke: (payload: string, bounds: { maxInputTokens: number; maxOutputTokens: number; timeoutMs: number }, signal: AbortSignal) => Promise<unknown>): Promise<string> {
  const { signal, ...raw } = input, p = requestSchema.safeParse(raw);
  if (!p.success || typeof invoke !== 'function' || (signal !== undefined && !(signal instanceof AbortSignal))) throw new ModelAccessError('MODEL_CONFIG_INVALID');
  const request = p.data, profile = gate.profile(), owner = gate.snapshot().scope;
  if (JSON.stringify(request.scope) !== JSON.stringify(owner)) throw new ModelAccessError('MODEL_STATE_CONFLICT');
  if (profile.mode !== 'offline-fixture') throw new ModelAccessError('MODEL_LIVE_DISABLED');
  if (signal?.aborted) throw new ModelAccessError('MODEL_CANCELLED');
  if (request.payload.length > profile.limits.maxInputCharacters) throw new ModelAccessError('MODEL_INPUT_LIMIT_EXCEEDED');
  const timeout = Math.min(profile.limits.timeoutMs, gate.remainingMs());
  if (timeout <= 0) throw new ModelAccessError('MODEL_DEADLINE_EXCEEDED');
  gate.reserve(request.callId, request.planned);
  const controller = new AbortController(), deadline = performance.now() + timeout;
  let timer: ReturnType<typeof setTimeout> | undefined, onAbort: (() => void) | undefined;
  const check = () => {
    if (signal?.aborted) throw new ModelAccessError('MODEL_CANCELLED');
    if (controller.signal.aborted || performance.now() >= deadline || gate.remainingMs() <= 0) throw new ModelAccessError('MODEL_DEADLINE_EXCEEDED');
  };
  try {
    check(); gate.dispatch(request.callId);
    const stop = new Promise<never>((_resolve, reject) => {
      onAbort = () => { controller.abort(); reject(new ModelAccessError('MODEL_CANCELLED')); };
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(new ModelAccessError('MODEL_DEADLINE_EXCEEDED')); }, Math.max(1, deadline - performance.now()));
      if (signal?.aborted) onAbort();
    });
    const result = await Promise.race([stop, Promise.resolve().then(async () => {
      check();
      try { return await invoke(request.payload, { maxInputTokens: request.planned.inputTokens, maxOutputTokens: request.planned.outputTokens, timeoutMs: timeout }, controller.signal); }
      catch { check(); throw new ModelAccessError('MODEL_DEPENDENCY_FAILED'); }
    })]);
    check();
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new ModelAccessError('MODEL_USAGE_INVALID');
    const response = result as { text?: unknown; usage?: unknown };
    // Account validated usage even when the returned text is unusable. A bad answer is not free.
    const settled = gate.settle(request.callId, response.usage);
    if (settled.entries.find(e => e.callId === request.callId)!.overrun) throw new ModelAccessError('MODEL_USAGE_OVERRUN');
    check();
    if (typeof response.text !== 'string' || response.text.length > profile.limits.maxOutputCharacters) throw new ModelAccessError('MODEL_OUTPUT_LIMIT_EXCEEDED');
    return response.text;
  } catch (e) {
    const entry = gate.snapshot().entries.find(e => e.callId === request.callId)!;
    // A dispatched call may have consumed provider resources. No implicit refund or retry.
    try { if (entry.status === 'reserved') gate.release(request.callId); else if (entry.status === 'dispatched') gate.markUnknown(request.callId); }
    catch { /* Keep conservative holds if the host clock or accounting state is itself invalid. */ }
    const code = ModelAccessErrorSchema.safeParse(e instanceof ModelAccessError ? e.code : undefined);
    throw new ModelAccessError(code.success ? code.data : 'MODEL_DEPENDENCY_FAILED');
  } finally { if (timer) clearTimeout(timer); if (onAbort) signal?.removeEventListener('abort', onAbort); }
}
