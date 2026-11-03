import { z } from 'zod';
import { ResourceCatalogSchema, ResourceQuerySchema, ResourceReceiptSchema, type ResourceReceipt } from '../../../../packages/contracts/src/resources.ts';
import { ToolContextSchema, type ErrorCode } from '../../../../packages/contracts/src/tools.ts';
import { describeError } from '../../../../packages/contracts/src/errors.ts';
import { AgentStateError } from '../planning/interview-state.ts';
export const ResourceOptionsSchema = z.object({ maxCalls: z.number().int().min(0).max(100).default(5),
  maxAgeMs: z.number().int().positive().max(365 * 86400000).default(30 * 86400000),
  allowDraftResources: z.boolean().default(false), now: z.custom<() => number>(v => typeof v === 'function').default(() => Date.now) }).strict();
/** Host-owned, snapshotted catalog only. This function never fetches a model-supplied URL. */
export function createResourceExecutor(rawContext: unknown, rawCatalog: unknown, rawOptions: unknown = {}) {
  const host = ToolContextSchema.safeParse(rawContext), catalog = ResourceCatalogSchema.safeParse(rawCatalog), config = ResourceOptionsSchema.safeParse(rawOptions);
  if (!host.success || !catalog.success || !config.success) throw new AgentStateError('VALIDATION_ERROR');
  const context = host.data, snapshot = catalog.data, options = config.data; let calls = 0;
  return async (callId: string, rawInput: unknown, signal?: AbortSignal): Promise<ResourceReceipt> => {
    const started = performance.now();
    const base = () => ({ callId, toolName: 'search_learning_resources' as const, durationMs: performance.now() - started });
    const fail = (code: ErrorCode): ResourceReceipt => {
      const { message, retryable } = describeError(code);
      return ResourceReceiptSchema.parse({ ...base(), status: 'error', sourceIds: [], error: { code, message, retryable } });
    };
    if (signal?.aborted) return fail('RUN_CANCELLED');
    const now = options.now();
    if (!Number.isSafeInteger(now) || now < 0) return fail('VALIDATION_ERROR');
    if (now >= context.deadlineAt) return fail('DEADLINE_EXCEEDED');
    const input = ResourceQuerySchema.safeParse(rawInput);
    if (!input.success) return fail('VALIDATION_ERROR');
    if (input.data.roleId !== context.roleId) return fail('ROLE_FORBIDDEN');
    if (calls >= options.maxCalls) return fail('TOOL_BUDGET_EXCEEDED'); calls++;
    const query = input.data;
    const items = snapshot.items.filter(r => r.roleId === context.roleId && r.skillIds.includes(query.skillId) && r.level === query.level
      && (r.reviewStatus === 'reviewed' || options.allowDraftResources) && r.availability === 'available'
      && r.verificationStatus === 'content-checked' && r.lastCheckedAt !== null && r.lastCheckedAt <= now
      && now - r.lastCheckedAt <= options.maxAgeMs)
      .sort((a,b) => (b.lastCheckedAt ?? 0) - (a.lastCheckedAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, query.limit);
    if (signal?.aborted) return fail('RUN_CANCELLED');
    const finishedAt = options.now();
    if (!Number.isSafeInteger(finishedAt) || finishedAt < now) return fail('VALIDATION_ERROR');
    if (finishedAt >= context.deadlineAt) return fail('DEADLINE_EXCEEDED');
    return ResourceReceiptSchema.parse({ ...base(), status: items.length ? 'ok' : 'empty',
      sourceIds: [...new Set(items.flatMap(i => i.sourceIds))], data: { catalogVersion: snapshot.version, items } });
  };
}
