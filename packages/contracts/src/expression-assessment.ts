import {z} from 'zod';
export const ExpressionEvidenceSchema=z.object({startMs:z.number().nonnegative().max(120000),endMs:z.number().positive().max(120000),quote:z.string().min(2).max(1000)}).strict().refine(v=>v.endMs-v.startMs>=300,'Evidence interval must cover at least 300ms');
export const ExpressionMetricSchema=z.object({score:z.number().int().min(0).max(4).nullable(),evidenceIntervals:z.array(ExpressionEvidenceSchema).max(8),observation:z.string().min(1).max(500)}).strict()
 .refine(v=>v.score===null?v.evidenceIntervals.length===0:v.evidenceIntervals.length>0,'Scores require evidence; abstentions carry no scored intervals');
export const ExpressionModelOutputSchema=z.object({clarity:ExpressionMetricSchema,confidentDelivery:ExpressionMetricSchema,vocalValence:ExpressionMetricSchema}).strict();
export const ExpressionAssessmentSchema=ExpressionModelOutputSchema.extend({
 version:z.literal(1),status:z.literal('unvalidated-model-estimate'),dataStatus:z.enum(['sufficient_data','insufficient_data']),
 source:z.object({audioSha256:z.string().regex(/^[a-f0-9]{64}$/),modelId:z.literal('qwen3.8-omni-flash'),durationMs:z.number().positive().max(120000)}).strict(),
 reliabilityValidated:z.literal(false),usedInFormalScore:z.literal(false),warnings:z.array(z.string().min(1).max(200)).max(12),
}).strict().superRefine((value,ctx)=>{
 const metrics=[value.clarity,value.confidentDelivery,value.vocalValence];
 if(value.dataStatus==='insufficient_data'&&metrics.some(m=>m.score!==null))ctx.addIssue({code:'custom',message:'Insufficient data cannot receive a score'});
 if(value.dataStatus==='sufficient_data'&&metrics.every(m=>m.score===null))ctx.addIssue({code:'custom',message:'All abstentions must remain insufficient data'});
 for(const metric of metrics)for(const interval of metric.evidenceIntervals)if(interval.endMs>value.source.durationMs)ctx.addIssue({code:'custom',message:'Evidence exceeds audio duration'});
});
export type ExpressionAssessment=z.infer<typeof ExpressionAssessmentSchema>;
const money=z.number().int().min(1).max(1_000_000_000);
export const ExpressionAssessmentConfigSchema=z.object({version:z.literal(1),enabled:z.boolean(),providerId:z.literal('qianwen'),modelId:z.literal('qwen3.8-omni-flash'),
 endpoint:z.literal('https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1'),timeoutMs:z.number().int().min(1).max(30000),maxOutputTokens:z.number().int().min(1).max(1500),
 authorization:z.object({allowLive:z.boolean(),expiresAt:z.number().int().nonnegative()}).strict(),
 budget:z.object({maxCalls:z.number().int().min(1).max(100),maxTotalAudioMs:z.number().int().positive().max(12_000_000),maxCostMicros:money,reserveCostMicrosPerCall:money}).strict(),
}).strict().refine(c=>c.budget.reserveCostMicrosPerCall<=c.budget.maxCostMicros);
