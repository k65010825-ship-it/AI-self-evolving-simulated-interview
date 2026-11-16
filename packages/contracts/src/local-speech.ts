import {z} from 'zod';
import {AsrServiceConfigSchema} from './asr-service.ts';
import {TtsConfigSchema} from './tts.ts';
const amount=z.number().int().nonnegative().max(1_000_000_000_000);
const common={maxCalls:z.number().int().min(1).max(100),maxCostMicros:amount,reserveCostMicrosPerCall:amount};
export const LocalSpeechPolicySchema=z.object({asrConfig:AsrServiceConfigSchema,ttsConfig:TtsConfigSchema,
 asrBudget:z.object({...common,maxAudioMs:z.number().int().positive().max(12_000_000)}).strict(),
 ttsBudget:z.object({...common,maxCharacters:z.number().int().positive().max(100_000)}).strict(),totalMaxCostMicros:amount,
}).strict().refine(p=>(!p.asrConfig.enabled||p.asrBudget.reserveCostMicrosPerCall>0)&&(!p.ttsConfig.enabled||p.ttsBudget.reserveCostMicrosPerCall>0)&&p.asrBudget.reserveCostMicrosPerCall<=p.asrBudget.maxCostMicros&&p.ttsBudget.reserveCostMicrosPerCall<=p.ttsBudget.maxCostMicros&&p.asrBudget.maxCostMicros+p.ttsBudget.maxCostMicros<=p.totalMaxCostMicros);
export type LocalSpeechPolicy=z.infer<typeof LocalSpeechPolicySchema>;
export const LocalSpeechCapabilitySchema=z.enum(['asr','tts']);
export type LocalSpeechCapability=z.infer<typeof LocalSpeechCapabilitySchema>;
const id=z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/);
export const LocalSpeechGrantInputSchema=z.object({sessionId:id,capability:LocalSpeechCapabilitySchema,grantId:id,credentialRef:id,expiresAt:z.number().int().nonnegative(),expectedVersion:z.number().int().nonnegative()}).strict();
export const LocalSpeechGrantSchema=LocalSpeechGrantInputSchema.omit({expectedVersion:true}).extend({version:z.number().int().positive(),configDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type LocalSpeechGrant=z.infer<typeof LocalSpeechGrantSchema>;
