import {z} from 'zod';
import {KnowledgeItemSchema,RoleIdSchema,ErrorCodeSchema} from './tools.ts';
import {LiveServiceConfigSchema} from './live-model.ts';
import {AgentRunSnapshotSchema} from './agent-run.ts';
import {EvaluationDiagnosticSchema} from './evaluation-diagnostic.ts';
import {ModelBudgetSnapshotSchema} from './model-access.ts';
const digest=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/);
export const ScoringQualityCaseSchema=z.object({id,roleId:RoleIdSchema,category:z.enum(['normal','insufficient','abstention','verification','incorrect','partial','mixed']),item:KnowledgeItemSchema,
 answer:z.string().min(1).max(10000),expectedOutcome:z.enum(['scored','needs_clarification','abstained']),
 reference:z.object({origin:z.literal('assistant-authored-draft'),rationale:z.string().min(1).max(1500),bands:z.array(z.object({criterionId:id,min:z.number().min(0).max(1),max:z.number().min(0).max(1)}).strict().refine(b=>b.min<=b.max)).max(20)}).strict(),
}).strict().superRefine((c,ctx)=>{
 const scored=['normal','verification','incorrect','partial','mixed'].includes(c.category);
 if(c.roleId!==c.item.roleId||c.expectedOutcome!==(scored?'scored':c.category==='abstention'?'abstained':'needs_clarification')||
  c.item.rubric.some(r=>!!r.verificationGoal)!==(c.category==='verification')||new Set(c.reference.bands.map(b=>b.criterionId)).size!==c.reference.bands.length||
  (scored?(c.reference.bands.length!==c.item.rubric.length||c.reference.bands.some(b=>!c.item.rubric.some(r=>r.criterionId===b.criterionId))):c.reference.bands.length!==0))ctx.addIssue({code:'custom',message:'Case and draft reference mismatch.'});
});
export type ScoringQualityCase=z.infer<typeof ScoringQualityCaseSchema>;
export const ScoringStabilityPolicySchema=z.object({version:z.literal(1),runs:z.literal(2),maxNormalizedDrift:z.literal(.25)}).strict();
export const ScoringQualityBatchSchema=z.object({version:z.literal(1),id,directory:z.string().min(1),createdAt:z.number().int(),origin:z.literal('assistant-authored-development'),suite:z.enum(['baseline','contrast','challenge']).optional(),stabilityPolicy:ScoringStabilityPolicySchema.optional(),
 cases:z.array(ScoringQualityCaseSchema).length(8),sourceManifest:z.array(z.object({path:z.string(),sha256:digest}).strict()).max(5000),config:LiveServiceConfigSchema,
 maxRequests:z.literal(6),maxDeclaredCostMicros:z.literal(2000000),humanReferenceCount:z.literal(0),qualityClaimEligible:z.literal(false),digest}).strict().refine(b=>(b.suite==='challenge')===(b.stabilityPolicy!==undefined),'Stability policy belongs to challenge batches only');
export const ScoringQualityAuthorizationSchema=z.object({version:z.literal(1),kind:z.enum(['live','injected-test-only']),operatorApproved:z.boolean(),batchId:id,batchDigest:digest,
 expiresAt:z.number().int().nonnegative(),maxRequests:z.literal(6),maxDeclaredCostMicros:z.literal(2000000),provider:z.object({providerId:z.literal('qianwen'),modelId:z.literal('qwen3.8-max'),endpoint:z.literal('https://maas.qianwenaiapi.com/compatible-mode/v1')}).strict(),
 credentialSource:z.object({platform:z.literal('qianwen'),env:z.literal('INTERVIEW_QIANWEN_API_KEY')}).strict(),}).strict();
export const ScoringQualityRowSchema=z.object({caseId:id,status:z.enum(['completed','failed','not_run']),requestDigest:digest.nullable(),snapshot:AgentRunSnapshotSchema.nullable(),errorCode:ErrorCodeSchema.nullable(),diagnostics:z.array(EvaluationDiagnosticSchema).max(16)}).strict();
export type ScoringQualityRow=z.infer<typeof ScoringQualityRowSchema>;
export type ScoringQualityBatch=z.infer<typeof ScoringQualityBatchSchema>;
export type ScoringQualityAuthorization=z.infer<typeof ScoringQualityAuthorizationSchema>;
const count=z.number().int().nonnegative();
export const ScoringQualityAnalysisSchema=z.object({total:z.literal(8),protocolCompleted:count.max(8),failed:count.max(8),unrun:count.max(8),expectedOutcomeMatched:count.max(8),
 bandAgreement:z.object({matched:count,paired:count,ratio:z.number().min(0).max(1).nullable()}).strict(),expectedBandCount:count,
 roles:z.array(z.object({roleId:RoleIdSchema,total:z.literal(4),outcomeMatched:count.max(4)}).strict()).length(2),
 observations:z.array(z.object({caseId:id,roleId:RoleIdSchema,category:ScoringQualityCaseSchema.shape.category,outcome:z.enum(['scored','needs_clarification','abstained','failed','not_run']),expectedOutcome:ScoringQualityCaseSchema.shape.expectedOutcome,outcomeMatched:z.boolean(),
  bands:z.array(z.object({criterionId:id,min:z.number().min(0).max(1),max:z.number().min(0).max(1),predicted:z.number().min(0).max(1),matched:z.boolean()}).strict()).max(20),evidenceValid:z.boolean().nullable(),bindingValid:z.boolean().nullable()}).strict()).length(8),
 draftChecksPassed:z.boolean(),humanReferenceCount:z.literal(0),qualityClaimEligible:z.literal(false),semanticReview:z.literal('assistant-authored-draft-only')}).strict();
export const ScoringQualityReportSchema=z.object({version:z.literal(1),scope:z.literal('shared-scoring-core'),mode:z.enum(['live-http','injected-http']),batchDigest:digest,authorizationDigest:digest,
 startedAt:z.number().int(),finishedAt:z.number().int(),status:z.enum(['passed-draft-checks','failed-draft-checks']),runError:z.enum(['SCORING_QUALITY_RUNTIME_FAILED','SCORING_QUALITY_SOURCE_CHANGED']).nullable(),stoppedForAccounting:z.boolean(),
 rows:z.array(ScoringQualityRowSchema).length(8),analysis:ScoringQualityAnalysisSchema,accounting:z.array(ModelBudgetSnapshotSchema).max(8),
 totals:z.object({httpAttempts:count.max(6),dispatchedAttempts:count.max(8),usedTokens:count,heldTokens:count,usedCostMicros:count,heldCostMicros:count}).strict(),
 humanReferenceCount:z.literal(0),qualityClaimEligible:z.literal(false),formalCommitted:z.literal(false),vendorBillingVerified:z.literal(false),digest}).strict();
