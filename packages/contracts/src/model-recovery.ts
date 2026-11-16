import{z}from'zod';
export const ModelRecoveryPolicySchema=z.object({httpMaxAttempts:z.number().int().min(1).max(3).default(1),
 maxModelRepairs:z.number().int().min(0).max(1).default(0),baseDelayMs:z.number().int().min(1).max(5000).default(250),
 maxDelayMs:z.number().int().min(1).max(5000).default(3000),
 initialOutputTokens:z.number().int().min(1).max(1000000).optional(),maxOutputRecoveries:z.number().int().min(0).max(1).default(0),
 truncationMode:z.enum(['regenerate','continue']).default('regenerate'),maxContextCompactions:z.number().int().min(0).max(1).default(0),
 autoCompact:z.object({enabled:z.boolean().default(false),windowTokens:z.number().int().min(1000).max(1000000).default(131072),
 triggerRatio:z.number().min(.1).max(.95).default(.8)}).strict().default({enabled:false,windowTokens:131072,triggerRatio:.8})
 }).strict().refine(p=>p.maxDelayMs>=p.baseDelayMs,'Invalid retry delay bounds');
/** Internal bounded host telemetry; no raw output, errors, headers, credentials or identity. */
export const ModelRecoveryEventSchema=z.object({version:z.literal(1),phase:z.enum(['http','evaluation']),
 outcome:z.enum(['retry-scheduled','repair-scheduled','recovered','stopped','compact-applied','upgrade-scheduled','continue-scheduled']),
 reason:z.enum(['http-429','http-503','invalid-json','invalid-schema','attempt-limit','repair-limit','retry-after-limit','budget',
 'unknown','cancelled','deadline','clock','dependency','non-retryable','valid','output-length','context-limit','auto-threshold','no-removable-context']),attempt:z.number().int().min(1).max(100),delayMs:z.number().int().min(0).max(5000)}).strict();
export type ModelRecoveryPolicy=z.infer<typeof ModelRecoveryPolicySchema>;
export type ModelRecoveryEvent=z.infer<typeof ModelRecoveryEventSchema>;
export type ModelRecoverySink=(event:ModelRecoveryEvent)=>void;
