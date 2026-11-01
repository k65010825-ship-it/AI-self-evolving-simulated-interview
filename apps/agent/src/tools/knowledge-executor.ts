import { z } from 'zod';
import javaSeed from '../../../../knowledge/java-backend/seed.json' with { type: 'json' };
import webSeed from '../../../../knowledge/web-frontend/seed.json' with { type: 'json' };
import { KnowledgeItemSchema, KnowledgeQuerySchema, ToolContextSchema, ToolReceiptSchema,
  type ErrorCode, type ToolContext, type ToolReceipt } from '../../../../packages/contracts/src/tools.ts';
import { describeError } from '../../../../packages/contracts/src/errors.ts';

const seed = z.array(KnowledgeItemSchema).parse([...javaSeed, ...webSeed]);
/** Development seed adapter; draft records are explicit, never a production repository. */
export function createKnowledgeExecutor(context: ToolContext, options: { maxCalls?: number; includeDrafts?: boolean } = {}) {
  const ctx = ToolContextSchema.parse(context);
  const maxCalls = options.maxCalls ?? 5;
  if (!Number.isInteger(maxCalls) || maxCalls < 0) throw new RangeError('maxCalls must be a nonnegative integer.');
  let calls = 0;
  return async (callId: string, raw: unknown, signal?: AbortSignal): Promise<ToolReceipt> => {
    const started = performance.now();
    const base = () => ({ callId, toolName: 'query_role_knowledge' as const, durationMs: Math.max(0, performance.now() - started) });
    const fail = (code: ErrorCode): ToolReceipt => {
      const { message, retryable } = describeError(code);
      return ToolReceiptSchema.parse({ ...base(), status: 'error', sourceIds: [], error: { code, message, retryable } });
    };
    if (signal?.aborted) return fail('RUN_CANCELLED');
    if (Date.now() >= ctx.deadlineAt) return fail('DEADLINE_EXCEEDED');
    const parsed = KnowledgeQuerySchema.safeParse(raw);
    if (!parsed.success) return fail('VALIDATION_ERROR');
    const input = parsed.data;
    if (input.roleId !== ctx.roleId) return fail('ROLE_FORBIDDEN');
    if (calls >= maxCalls) return fail('TOOL_BUDGET_EXCEEDED');
    calls++;
    const query = input.query?.toLocaleLowerCase();
    const items = seed.filter((item) => item.roleId === ctx.roleId && item.skillId === input.skillId
      && (options.includeDrafts !== false || item.reviewStatus === 'reviewed')
      && (!query || `${item.question} ${item.keyPoints.join(' ')}`.toLocaleLowerCase().includes(query))).slice(0, input.limit);
    if (signal?.aborted) return fail('RUN_CANCELLED');
    if (Date.now() >= ctx.deadlineAt) return fail('DEADLINE_EXCEEDED');
    return ToolReceiptSchema.parse({ ...base(), status: items.length ? 'ok' : 'empty',
      sourceIds: [...new Set(items.flatMap((item) => item.sourceIds))], data: { items } });
  };
}
