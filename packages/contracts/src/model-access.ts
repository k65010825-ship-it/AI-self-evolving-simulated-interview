import { z } from 'zod';
import { RoleIdSchema } from './tools.ts';
const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/);
const amount = z.number().int().min(0).max(1_000_000_000_000);
export const DeclaredRatesSchema = z.object({ inputMicrosPerMillionTokens: z.number().int().min(0).max(1_000_000_000),
  outputMicrosPerMillionTokens: z.number().int().min(0).max(1_000_000_000) }).strict();
export const ModelLimitsSchema = z.object({ maxCalls: z.number().int().min(1).max(100), maxConcurrent: z.number().int().min(1).max(8),
  maxInputTokens: z.number().int().min(1).max(1_000_000), maxOutputTokens: z.number().int().min(1).max(1_000_000),
  maxTotalTokens: z.number().int().min(1).max(10_000_000), maxCostMicros: amount,
  maxInputCharacters: z.number().int().min(1).max(100000), maxOutputCharacters: z.number().int().min(1).max(100000),
  timeoutMs: z.number().int().min(1).max(60000),
}).strict().refine(l => l.maxConcurrent <= l.maxCalls, 'Concurrency cannot exceed call budget');
const common = { profileId: id, version: id, limits: ModelLimitsSchema };
const pricing = { id, version: id, currency: z.enum(['USD','CNY']), rates: DeclaredRatesSchema };
export const LiveModelProfileSchema=z.object({...common,mode:z.literal('live-service'),providerId:z.enum(['bailian','qianwen']),modelId:id,
 apiFamily:z.literal('openai-completions'),endpoint:z.url().refine(value=>{
  const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&!u.port&&u.pathname==='/compatible-mode/v1'
   &&(['dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com','maas.qianwenaiapi.com'].includes(u.hostname)||/^[a-z0-9][a-z0-9-]{0,100}\.(cn-beijing|ap-southeast-1|us-east-1|ap-northeast-1)\.maas\.aliyuncs\.com$/.test(u.hostname));
 }),credentialSource:z.object({kind:z.literal('env-reference-only'),name:z.string().regex(/^INTERVIEW_[A-Z0-9_]{1,80}$/)}).strict(),
 pricing:z.object({...pricing,currency:z.literal('CNY'),provenance:z.literal('host-declared-unverified')}).strict()
}).strict().refine(p=>p.pricing.rates.inputMicrosPerMillionTokens>0&&p.pricing.rates.outputMicrosPerMillionTokens>0)
 .refine(p=>(p.providerId==='qianwen')===(new URL(p.endpoint).hostname==='maas.qianwenaiapi.com'),'Provider and endpoint platform must match');
export const ModelAccessProfileSchema = z.discriminatedUnion('mode', [
  z.object({ ...common, mode: z.literal('offline-fixture'), providerId: z.literal('local-fixture'), modelId: id,
    apiFamily: z.literal('fixture-only'), credentialSource: z.object({ kind: z.literal('none') }).strict(),
    pricing: z.object({ ...pricing, provenance: z.literal('synthetic-not-current-pricing') }).strict(),
  }).strict(),
  z.object({ ...common, mode: z.literal('live-planned'), providerId: id, modelId: id, apiFamily: id,
    endpoint: z.url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; }),
    credentialSource: z.object({ kind: z.literal('env-reference-only'), name: z.string().regex(/^INTERVIEW_[A-Z0-9_]{1,80}$/) }).strict(),
    pricing: z.object({ ...pricing, provenance: z.literal('host-declared-unverified') }).strict(),
  }).strict(),
  LiveModelProfileSchema,
]);
export const ModelPreflightSchema = z.object({ configValid: z.boolean(), mode: z.enum(['offline-fixture', 'live-planned','live-service']).nullable(),
  canExecuteFixture: z.boolean(), canExecuteLive: z.literal(false), credentialInspection: z.literal('not-performed'), networkAccess: z.literal('disabled'),
  issues: z.array(z.enum(['MODEL_CONFIG_INVALID', 'LIVE_TRANSPORT_DISABLED', 'PROVIDER_MODEL_OR_PRICING_UNSELECTED'])) }).strict();
export const ModelBudgetScopeSchema = z.object({ budgetId: id, userId: z.string().min(1).max(100), roleId: RoleIdSchema,
  runId: id, attemptId: id, deadlineAt: z.number().int().nonnegative() }).strict();
export const PlannedTokensSchema = z.object({ inputTokens: z.number().int().min(1).max(1_000_000), outputTokens: z.number().int().min(1).max(1_000_000) }).strict();
export const ModelUsageSchema = z.object({ inputTokens: z.number().int().min(0).max(10_000_000), outputTokens: z.number().int().min(0).max(10_000_000),
  complete: z.literal(true), reportedCostMicros: amount.optional() }).strict();
export const ModelAccessErrorSchema = z.enum(['MODEL_CONFIG_INVALID', 'MODEL_LIVE_DISABLED', 'MODEL_CLOCK_INVALID', 'MODEL_DEADLINE_EXCEEDED',
  'MODEL_CONCURRENCY_EXCEEDED', 'MODEL_CALL_ID_REUSED', 'MODEL_STATE_CONFLICT', 'MODEL_TOKEN_BUDGET_EXCEEDED', 'MODEL_COST_BUDGET_EXCEEDED',
  'MODEL_CALL_BUDGET_EXCEEDED', 'MODEL_BUDGET_LOCKED', 'MODEL_USAGE_INVALID', 'MODEL_USAGE_OVERRUN', 'MODEL_CANCELLED', 'MODEL_DEPENDENCY_FAILED',
  'MODEL_INPUT_LIMIT_EXCEEDED', 'MODEL_OUTPUT_LIMIT_EXCEEDED']);
export const ModelBudgetEntrySchema = z.object({ callId: id, status: z.enum(['reserved', 'dispatched', 'unknown', 'released', 'settled','rejected']),
  rejectionStatus:z.union([z.literal(400),z.literal(413),z.literal(429),z.literal(503)]).optional(),
  planned: PlannedTokensSchema, reservedCostMicros: amount, usage: ModelUsageSchema.optional(), actualCostMicros: amount.optional(), overrun: z.boolean() }).strict();
export const ModelBudgetSnapshotSchema = z.object({ version: z.number().int().nonnegative(), profileDigest: z.string().regex(/^[a-f0-9]{64}$/),
  currency:z.enum(['USD','CNY']).optional(),
  scope: ModelBudgetScopeSchema, mode: z.enum(['offline-fixture', 'live-planned','live-service']), locked: z.boolean(),
  accounting: z.literal('in-memory-declared-rate-not-vendor-billing'), entries: z.array(ModelBudgetEntrySchema).max(100),
  totals: z.object({ callsConsumed: z.number().int().nonnegative(), activeSlots: z.number().int().nonnegative(), heldTokens: z.number().int().nonnegative(), usedTokens: z.number().int().nonnegative(),
    heldCostMicros: z.number().int().nonnegative(), usedCostMicros: z.number().int().nonnegative() }).strict(),
}).strict();
export type ModelAccessProfile = z.infer<typeof ModelAccessProfileSchema>;
export type ModelBudgetEntry = z.infer<typeof ModelBudgetEntrySchema>;
export type ModelUsage = z.infer<typeof ModelUsageSchema>;
export type ModelAccessErrorCode = z.infer<typeof ModelAccessErrorSchema>;
