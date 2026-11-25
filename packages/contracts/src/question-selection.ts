import { z } from 'zod';
import { InterviewStateSchema } from './interview-state.ts';
import { KnowledgeItemSchema } from './tools.ts';
import { TurnInputSchema, NextActionSchema } from './evaluation.ts';
import { RubricSchema } from './scoring.ts';
import{PlanningPolicyVersionSchema}from'./policy.ts';
import {KnowledgeCatalogPinSchema} from './knowledge-catalog.ts';
export const QuestionPlanProvenanceSchema=z.object({version:z.literal('catalog-unseen-v1'),catalogId:z.string().min(1).max(100),
 catalogDigest:z.string().regex(/^[a-f0-9]{64}$/),decidedAt:z.number().int().nonnegative(),intent:NextActionSchema}).strict();
export const ExecutedQuestionPlanSchema=z.object({questionId:z.string().min(1).max(100),issuedAt:z.number().int().nonnegative(),
 plan:NextActionSchema,provenance:QuestionPlanProvenanceSchema}).strict();
export const QuestionSelectionInputSchema = z.object({ state: InterviewStateSchema, now: z.number().int().nonnegative(),
  knowledge: z.array(KnowledgeItemSchema).max(500), askedQuestionIds: z.array(z.string().min(1).max(100)).max(200),
  planningPolicy:PlanningPolicyVersionSchema.optional(),catalogPin:KnowledgeCatalogPinSchema.optional() }).strict();
const base = z.object({ plan: NextActionSchema,provenance:QuestionPlanProvenanceSchema.optional() });
export const QuestionSelectionSchema = z.discriminatedUnion('status', [
  base.extend({ status: z.literal('finished') }).strict(),
  base.extend({ status: z.literal('unavailable'), reason: z.literal('no_eligible_question') }).strict(),
  base.extend({ status: z.literal('selected'), question: TurnInputSchema.shape.question,
    rubric: RubricSchema, source: z.object({ knowledgeId: z.string().min(1), version: z.string().min(1),
      sourceIds: z.array(z.string().min(1)).min(1), reviewStatus: KnowledgeItemSchema.shape.reviewStatus }).strict() }).strict(),
]);
export type QuestionSelection = z.infer<typeof QuestionSelectionSchema>;
export const QuestionIssueEvidenceSchema=QuestionSelectionSchema.options[2].pick({question:true,rubric:true,source:true})
 .extend({questionId:z.string().min(1).max(100),issuedAt:z.number().int().nonnegative()}).strict();
