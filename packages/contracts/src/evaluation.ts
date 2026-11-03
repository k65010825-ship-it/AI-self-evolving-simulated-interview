import { z } from 'zod';
import { InterviewStateSchema } from './interview-state.ts';
import { KnowledgeItemSchema, ToolContextSchema, RoleIdSchema } from './tools.ts';
import { RubricSchema, ScoringInputSchema, ScoringContextSchema, ScoringResultSchema } from './scoring.ts';
import {PlanningPolicyVersionSchema} from './policy.ts';
import { SpeechAnswerSchema } from './speech.ts';
const id = z.string().trim().min(1).max(100);
export const TurnInputSchema = z.object({ state: InterviewStateSchema, expectedVersion: z.number().int().nonnegative(),
  observationId: id, goal: z.string().min(1).max(500), context: ToolContextSchema,
  question: z.object({ id, roleId: RoleIdSchema, skillId: id, text: z.string().min(1).max(4000),
    questionType: KnowledgeItemSchema.shape.questionType, difficulty: KnowledgeItemSchema.shape.difficulty }).strict(),
  answer: z.object({ id, text: z.string().min(1).max(10000) }).strict(),
  quality: z.number().positive().max(1), rubric: RubricSchema, knowledge: z.array(KnowledgeItemSchema).max(100),
  planningPolicy:PlanningPolicyVersionSchema.optional(),
  speech:SpeechAnswerSchema.optional(),
}).strict();
export const NextActionSchema = z.object({ action: z.enum(['deepen', 'switch_skill', 'adjust_difficulty', 'finish']), skillId: id.nullable(),
  difficulty: KnowledgeItemSchema.shape.difficulty, remainingSeconds: z.number().int().nonnegative(), reason: z.string().min(1) }).strict();
/** The model proposes excerpts; the host must verify them against the actual answer. */
export const EvaluationOutputSchema = z.object({ evidence: ScoringContextSchema.shape.evidence,
  criterionScores: ScoringInputSchema.shape.criterionScores,
  feedback: z.object({ strengths: z.array(z.string().min(1).max(500)).max(5),
    improvements: z.array(z.string().min(1).max(500)).min(1).max(5) }).strict(),
}).strict();
export const TurnProposalSchema = z.object({
  kind: z.literal('uncommitted-turn-proposal'), basedOn: z.object({ sessionId: id, sessionVersion: z.number().int().nonnegative(),
    runId: ToolContextSchema.shape.runId, attemptId: ToolContextSchema.shape.attemptId, answerId: id, questionId: id }).strict(),
  evaluation: ScoringResultSchema, evidence: ScoringContextSchema.shape.evidence,
  feedback: EvaluationOutputSchema.shape.feedback, nextState: InterviewStateSchema,
  nextAction: NextActionSchema,
}).strict();
export type TurnInput = z.infer<typeof TurnInputSchema>;
export type TurnProposal = z.infer<typeof TurnProposalSchema>;
