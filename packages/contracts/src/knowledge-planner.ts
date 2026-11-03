import{z}from'zod';
import{InterviewStateSchema}from'./interview-state.ts';
import{ToolContextSchema,ToolReceiptSchema}from'./tools.ts';
import{PlanningPolicyVersionSchema}from'./policy.ts';
import{QuestionSelectionSchema}from'./question-selection.ts';
export const PlannerInputSchema=z.object({state:InterviewStateSchema,context:ToolContextSchema,goal:z.string().min(1).max(500),
 askedQuestionIds:z.array(z.string().min(1).max(100)).max(200),planningPolicy:PlanningPolicyVersionSchema.optional(),allowDraftKnowledge:z.boolean().default(false)}).strict();
export const PlannerQuerySchema=z.object({skillId:z.string().min(1).max(100),query:z.string().max(200).optional(),limit:z.number().int().min(1).max(3).default(2)}).strict();
export const PlannerChoiceSchema=z.object({questionId:z.string().min(1).max(100).nullable()}).strict();
export const PlannerResultSchema=z.object({kind:z.literal('uncommitted-knowledge-plan'),selection:QuestionSelectionSchema,
 receipts:z.array(ToolReceiptSchema).max(3),modelMessages:z.number().int().min(0).max(4)}).strict();
export type PlannerInput=z.infer<typeof PlannerInputSchema>;
export type PlannerResult=z.infer<typeof PlannerResultSchema>;
