import {z} from 'zod';
import {LiveServiceConfigSchema} from './live-model.ts';
import {LocalSpeechPolicySchema} from './local-speech.ts';
const hash=z.string().regex(/^[a-f0-9]{64}$/),path=z.string().min(1).max(2048).refine(s=>!/[\x00-\x1f]/.test(s)),amount=z.number().int().nonnegative();
export const LocalAcceptanceSourceSchema=z.object({path:z.string().regex(/^[A-Za-z0-9_./-]+$/),sha256:hash}).strict();
export const LocalAcceptanceCredentialSchema=z.object({credentialRef:z.enum(['acceptance-llm','acceptance-asr','acceptance-tts']),platform:z.enum(['qianwen','bailian']),env:z.enum(['INTERVIEW_QIANWEN_API_KEY','INTERVIEW_BAILIAN_ASR_API_KEY'])}).strict();
export const LocalAcceptanceSampleSchema=z.object({roleId:z.enum(['java-backend','web-frontend']),origin:z.enum(['synthetic-development','user-provided']),answerText:z.string().trim().min(1).max(10000),audio:z.object({path:z.string().regex(/^inputs\/(java-backend|web-frontend)\.wav$/),sha256:hash,bytes:amount,durationMs:z.number().positive().max(120000)}).strict().optional()}).strict();
export const LocalAcceptanceBatchSchema=z.object({version:z.literal(1),id:z.string().regex(/^[a-f0-9]{24}$/),path,createdAt:amount,mode:z.enum(['text','speech']),sourceRoot:path,sourceManifest:z.array(LocalAcceptanceSourceSchema).min(1).max(5000),sourceDigest:hash,
 artifact:z.object({kind:z.enum(['production','injected-test-only']),output:path,executable:path,entry:path,assetsRoot:path,manifestSha256:hash,files:z.array(z.object({path,sha256:hash}).strict()).length(2)}).strict(),
 samples:z.array(LocalAcceptanceSampleSchema).length(2),liveConfig:LiveServiceConfigSchema,sessionBudget:z.object({maxCalls:z.literal(3),maxTotalTokens:z.literal(48000),maxCostMicros:z.literal(1000000)}).strict(),speechPolicy:LocalSpeechPolicySchema.nullable(),credentials:z.array(LocalAcceptanceCredentialSchema).min(1).max(3),maxRequests:z.union([z.literal(6),z.literal(10)]),maxCostMicros:z.union([z.literal(2000000),z.literal(3000000)]),humanReferenceCount:z.literal(0),qualityClaimEligible:z.literal(false),digest:hash}).strict();
const provider=z.object({providerId:z.string().min(1).max(40),modelId:z.string().min(1).max(80),endpoint:z.url()}).strict();
export const LocalAcceptanceAuthorizationSchema=z.object({version:z.literal(1),kind:z.enum(['live','injected-test-only']),operatorApproved:z.literal(true),batchId:z.string().regex(/^[a-f0-9]{24}$/),batchDigest:hash,expiresAt:amount,maxRequests:amount,maxCostMicros:amount,credentialSources:z.array(LocalAcceptanceCredentialSchema).min(1).max(3),provider,speechProviders:z.object({asr:provider,tts:provider}).strict().optional()}).strict();
export type LocalAcceptanceBatch=z.infer<typeof LocalAcceptanceBatchSchema>;
export type LocalAcceptanceAuthorization=z.infer<typeof LocalAcceptanceAuthorizationSchema>;

