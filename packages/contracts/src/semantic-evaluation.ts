import { z } from 'zod';
import { RoleIdSchema, ErrorCodeSchema } from './tools.ts';
import { RubricSchema, ScoringContextSchema } from './scoring.ts';
const id=z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const SupportLabelSchema=z.enum(['supported','contradicted','insufficient']);
export const SemanticDatasetSchema=z.object({version:z.literal(1),id,origin:z.literal('assistant-authored-synthetic'),reviewStatus:z.literal('draft'),
 baseDatasetDigest:digest,split:z.literal('development'),claims:z.array(z.object({id,caseId:id,caseDigest:digest,rubricDigest:digest,criterionId:id,
 claimedScore:z.number().min(0).max(100),quotes:z.array(z.object({start:z.number().int().nonnegative(),end:z.number().int().positive()}).strict()).min(1).max(4),
 reference:z.object({verdict:SupportLabelSchema,rationale:z.string().min(1).max(2000)}).strict()}).strict()).min(1).max(200)}).strict();
export const SemanticRequestSchema=z.object({roleId:RoleIdSchema,question:z.object({text:z.string().min(1),skillId:id,questionType:z.string().min(1)}).strict(),
 answer:z.string().min(1).max(4000),rubric:z.object({id:RubricSchema.shape.id,version:RubricSchema.shape.version,scope:RubricSchema.shape.scope}).strict(),criterion:RubricSchema.shape.criteria.element,
 claimedScore:z.number().min(0).max(100),quotes:ScoringContextSchema.shape.evidence}).strict();
export const SemanticVerdictSchema=z.object({verdict:z.enum(['supported','contradicted','insufficient','uncertain'])}).strict();
export const SemanticRowSchema=z.discriminatedUnion('status',[
 z.object({claimId:id,status:z.literal('completed'),verdict:SemanticVerdictSchema.shape.verdict,verdictDigest:digest}).strict(),
 z.object({claimId:id,status:z.enum(['failed','cancelled','timed_out']),error:ErrorCodeSchema}).strict(),
]);
export type SemanticRequest=z.infer<typeof SemanticRequestSchema>;
export type SemanticRow=z.infer<typeof SemanticRowSchema>;

const count=z.number().int().nonnegative(),rate=z.number().min(0).max(1).nullable();
export const SemanticMetricSchema=z.object({total:count,completed:count,failed:count,abstained:count,correct:count,accuracy:rate,judgmentCoverage:rate,
 unsupportedTotal:count,unsupportedJudged:count,unsupportedAccepted:count,unsupportedAcceptanceRate:rate,unsupportedJudgmentCoverage:rate,
 classes:z.array(z.object({label:SupportLabelSchema,tp:count,fp:count,fn:count,precision:rate,recall:rate,f1:rate}).strict()).length(3),macroF1:rate,
 confusion:z.array(z.object({reference:SupportLabelSchema,supported:count,contradicted:count,insufficient:count,uncertain:count,failed:count}).strict()).length(3)}).strict();
