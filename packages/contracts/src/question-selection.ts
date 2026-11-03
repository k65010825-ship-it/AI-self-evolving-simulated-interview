import { z } from 'zod';
import { InterviewStateSchema } from './interview-state.ts';
import { KnowledgeItemSchema } from './tools.ts';
import { TurnInputSchema, NextActionSchema } from './evaluation.ts';
import { RubricSchema } from './scoring.ts';
import{PlanningPolicyVersionSchema}from'./policy.ts';
export const QuestionSelectionInputSchema = z.object({ state: InterviewStateSchema, now: z.number().int().nonnegative(),
  knowledge: z.array(KnowledgeItemSchema).max(500), askedQuestionIds: z.array(z.string().min(1).max(100)).max(200),
  planningPolicy:PlanningPolicyVersionSchema.optional() }).strict();
const base = z.object({ plan: NextActionSchema });
export const QuestionSelectionSchema = z.discriminatedUnion('status', [
  base.extend({ status: z.literal('finished') }).strict(),
  base.extend({ status: z.literal('unavailable'), reason: z.literal('no_eligible_question') }).strict(),
  base.extend({ status: z.literal('selected'), question: TurnInputSchema.shape.question,
    rubric: RubricSchema, source: z.object({ knowledgeId: z.string().min(1), version: z.string().min(1),
      sourceIds: z.array(z.string().min(1)).min(1), reviewStatus: KnowledgeItemSchema.shape.reviewStatus }).strict() }).strict(),
]);
export type QuestionSelection = z.infer<typeof QuestionSelectionSchema>;
