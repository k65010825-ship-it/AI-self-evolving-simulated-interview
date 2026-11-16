import { z } from 'zod';
import { MemoryIdentitySchema } from './memory.ts';
import { CreateInterviewStateSchema, HistoricalEvidenceSchema, InterviewStateSchema } from './interview-state.ts';
import { LearningIdentitySchema, PredictionSchema, LearningProgressSchema, DataModeSchema } from './learning.ts';
import { QuestionSelectionSchema } from './question-selection.ts';
const id=z.string().trim().min(1).max(100),time=z.number().int().nonnegative();
export const PracticeGoalsRequestSchema=MemoryIdentitySchema.extend({session:CreateInterviewStateSchema,now:time,maxGoals:z.number().int().min(1).max(5).default(3)}).strict();
export const PracticeGoalsSchema=MemoryIdentitySchema.extend({kind:z.literal('uncommitted-practice-goals'),sessionId:id,memoryVersion:time,plannedAt:time,
 goals:z.array(z.object({skillId:id,mastery:z.number().min(0).max(1).nullable(),confidence:z.number().min(0).max(1),priority:z.number().min(0).max(1),
  reason:z.enum(['weak_evidence','uncertain_evidence','no_evidence']),evidence:z.array(HistoricalEvidenceSchema).max(5)}).strict()).max(5),
 excludedQuestionIds:z.array(id).max(4000)}).strict();
export const RetestCandidateSchema=QuestionSelectionSchema.options[2].omit({status:true,plan:true}).superRefine((c,ctx)=>{
 if(c.question.roleId!==c.rubric.roleId||c.question.id!==c.source.knowledgeId||c.rubric.scope!==(c.question.questionType==='behavioral'?'behavioral-content':'technical-content'))
  ctx.addIssue({code:'custom',message:'Candidate provenance, role or content scope mismatch.'});
});
export const PlanRetestSchema=LearningIdentitySchema.extend({prediction:PredictionSchema,progress:LearningProgressSchema,state:InterviewStateSchema,
 now:time,askedQuestionIds:z.array(id).max(200),candidates:z.array(RetestCandidateSchema).max(500),allowDraftKnowledge:z.boolean().default(false)}).strict();
const base=LearningIdentitySchema.extend({kind:z.literal('uncommitted-retest-plan'),predictionId:id,dataMode:DataModeSchema,
 basedOn:z.object({sessionId:id,stateVersion:time,progressVersion:time,plannedAt:time}).strict(),
 excluded:z.array(z.object({questionId:id,reason:z.enum(['question_repeated','skill_mismatch','difficulty_mismatch','rubric_mismatch','construct_mismatch','review_required'])}).strict()).max(500)});
export const RetestPlanSchema=z.discriminatedUnion('status',[
 base.extend({status:z.literal('ready'),candidate:RetestCandidateSchema}).strict(),
 base.extend({status:z.literal('blocked'),reasons:z.array(z.enum(['learning_not_verified','learning_outside_window','prediction_not_prior','prediction_expired',
  'session_reused','skill_not_configured','time_budget','data_mode_mismatch','unverified_data_mode','model_source_unverified'])).min(1)}).strict(),
 base.extend({status:z.literal('unavailable'),reason:z.literal('no_matching_unseen_question')}).strict(),
]);
export type RetestCandidate=z.infer<typeof RetestCandidateSchema>;
export type RetestPlan=z.infer<typeof RetestPlanSchema>;
