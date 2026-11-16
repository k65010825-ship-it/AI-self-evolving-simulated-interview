import {z} from 'zod';
import {ToolContextSchema} from './tools.ts';
const money=z.number().int().min(1).max(1_000_000_000);
export const AsrServiceConfigSchema=z.object({version:z.literal(1),enabled:z.boolean(),providerId:z.enum(['bailian','qianwen']),
 modelId:z.enum(['qwen3-asr-flash','qwen3.8-omni-flash']),endpoint:z.url().refine(value=>{
  const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&u.pathname==='/compatible-mode/v1'&&
   (['dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com','cn-beijing.maas.qianwenaiapi.com'].includes(u.hostname)||/^[a-z0-9][a-z0-9-]{0,100}\.(cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com$/.test(u.hostname));
 }),credentialEnv:z.literal('INTERVIEW_BAILIAN_ASR_API_KEY'),timeoutMs:z.number().int().min(1).max(30000),maxOutputTokens:z.number().int().min(1).max(4096).default(512),
 authorization:z.object({allowLive:z.boolean(),expiresAt:z.number().int().nonnegative()}).strict(),
 budget:z.object({maxCalls:z.number().int().min(1).max(100),maxTotalAudioMs:z.number().int().min(1).max(12_000_000),
  maxCostMicros:money,reserveCostMicrosPerCall:money}).strict(),
}).strict().refine(c=>c.budget.reserveCostMicrosPerCall<=c.budget.maxCostMicros)
 .refine(c=>c.providerId==='qianwen'
  ?c.modelId==='qwen3.8-omni-flash'&&new URL(c.endpoint).hostname==='cn-beijing.maas.qianwenaiapi.com'
  :c.modelId==='qwen3-asr-flash'&&new URL(c.endpoint).hostname!=='cn-beijing.maas.qianwenaiapi.com','Provider, model and endpoint must match');
export const AsrAccountingSchema=z.object({version:z.literal(1),context:ToolContextSchema,
 accounting:z.literal('in-memory-host-declared-cost-holds-not-vendor-billing'),vendorBillingVerified:z.literal(false),
 blocked:z.boolean(),callsConsumed:z.number().int().nonnegative(),audioMsConsumed:z.number().nonnegative(),heldCostMicros:z.number().int().nonnegative(),
 entries:z.array(z.object({callId:z.string().min(1).max(100),audioMs:z.number().positive().max(120000),reservedCostMicros:money,
  status:z.enum(['dispatched','responded','rejected','unknown']),httpStatus:z.number().int().min(100).max(599).optional(),
  usage:z.object({inputTokens:z.number().int().nonnegative(),outputTokens:z.number().int().nonnegative(),totalTokens:z.number().int().nonnegative()}).strict().optional(),
 }).strict()).max(100),
}).strict();
export type AsrServiceConfig=z.infer<typeof AsrServiceConfigSchema>;
export type AsrAccounting=z.infer<typeof AsrAccountingSchema>;
