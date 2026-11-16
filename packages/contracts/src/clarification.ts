import { z } from 'zod';
import { TurnProposalSchema } from './evaluation.ts';
const id=z.string().min(1).max(100),hash=z.string().regex(/^[a-f0-9]{64}$/);
/** Fixed neutral host text; model/candidate output may not provide answer-leading prompts. */
export const NEUTRAL_CLARIFICATION_PROMPT='请补充你的关键判断、理由和具体处理过程；若暂不确定，也可以明确说明。';
export const OBSERVATION_CLARIFICATION_PROMPT='请明确本次验证的条件、采取的操作，以及对应的观察或预期结果；可在一句话中说明它们的关系。若暂不确定，也可以明确说明。';
export const ClarificationPolicySchema=z.object({maxClarifications:z.number().int().min(0).max(2).default(1),
 minRemainingSeconds:z.number().int().min(15).max(120).default(45)}).strict();
export const UnscoredTurnSchema=z.object({kind:z.literal('uncommitted-unscored-turn'),status:z.enum(['needs_clarification','abstained']),
 basedOn:TurnProposalSchema.shape.basedOn,observationId:id,inputDigest:hash,answerDigest:hash,answerCharacters:z.number().int().min(1).max(10000),
 policy:ClarificationPolicySchema,attempt:z.number().int().min(0).max(2),remainingSeconds:z.number().int().nonnegative(),
 issuedAt:z.number().int().nonnegative(),missingCriterionIds:z.array(id).min(1).max(20).refine(a=>new Set(a).size===a.length),
 normalizedScore:z.null(),clarification:z.string().min(1).max(300).nullable(),reason:z.enum(['evidence_insufficient','clarification_limit','time_budget']),
 clarificationTemplate:z.literal('observation-v1').optional(),digest:hash}).strict()
 .superRefine((r,ctx)=>{
  if(r.attempt>r.policy.maxClarifications||(r.status==='needs_clarification'?(r.clarification===null||r.reason!=='evidence_insufficient'||r.attempt===0):r.clarification!==null||r.reason==='evidence_insufficient'||r.clarificationTemplate!==undefined))
   ctx.addIssue({code:'custom',message:'Invalid clarification state.'});
 });
export const ClarificationOptionsSchema=z.object({policy:ClarificationPolicySchema.optional(),previous:UnscoredTurnSchema.optional()}).strict();
export const TurnResolutionSchema=z.union([z.object({status:z.literal('scored'),proposal:TurnProposalSchema}).strict(),UnscoredTurnSchema]);
export type UnscoredTurn=z.infer<typeof UnscoredTurnSchema>;
export type TurnResolution=z.infer<typeof TurnResolutionSchema>;
