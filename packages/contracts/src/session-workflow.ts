import{z}from'zod';
import{CreateInterviewStateSchema,InterviewStateSchema}from'./interview-state.ts';
import{MemoryIdentitySchema,MemorySnapshotSchema}from'./memory.ts';
import{PlanningPolicyVersionSchema}from'./policy.ts';
import{ReportInputSchema,ContentReportSchema}from'./report.ts';
import{ReflectionSchema}from'./reflection.ts';
import{PlannerResultSchema}from'./knowledge-planner.ts';
import{QuestionSelectionSchema}from'./question-selection.ts';
import{ToolContextSchema}from'./tools.ts';
import{TurnInputSchema}from'./evaluation.ts';
import{SpeechAnswerSchema}from'./speech.ts';
const id=z.string().min(1).max(100);
export const CreateWorkflowSchema=z.object({identity:MemoryIdentitySchema,session:CreateInterviewStateSchema,policy:PlanningPolicyVersionSchema,
 goal:z.string().min(1).max(500),skillLabels:ReportInputSchema.shape.skillLabels,memory:MemorySnapshotSchema.optional(),
 allowDraftKnowledge:z.boolean().default(false),now:z.number().int().nonnegative()}).strict();
export const CloseoutSchema=z.object({kind:z.literal('uncommitted-interview-closeout'),sessionId:id,sessionVersion:z.number().int().nonnegative(),
 generatedAt:z.number().int().nonnegative(),sourceGroupId:id,requestRevision:z.number().int().nonnegative(),requestMode:z.enum(['automatic','user_stop']),reason:z.enum(['plan_finished','knowledge_gap','user_stop']),
 report:ContentReportSchema,memoryCandidate:MemorySnapshotSchema,memoryDisposition:z.enum(['appended','unchanged_no_answers']),reflection:ReflectionSchema}).strict();
export const WorkflowSchema=z.object({kind:z.literal('uncommitted-interview-session'),revision:z.number().int().nonnegative(),
 identity:MemoryIdentitySchema,state:InterviewStateSchema,policy:PlanningPolicyVersionSchema,goal:z.string().min(1).max(500),
 skillLabels:ReportInputSchema.shape.skillLabels,baseMemory:MemorySnapshotSchema,allowDraftKnowledge:z.boolean(),
 phase:z.enum(['ready_to_plan','awaiting_answer','ready_to_close','completed']),
 turns:ReportInputSchema.shape.turns,askedQuestionIds:z.array(id).max(200),
 issuedQuestions:z.array(z.object({questionId:id,issuedAt:z.number().int().nonnegative()}).strict()).max(200),
 current:QuestionSelectionSchema.options[2].nullable(),currentIssuedAt:z.number().int().nonnegative().nullable(),lastPlan:PlannerResultSchema.nullable(),
 pendingReason:z.enum(['plan_finished','knowledge_gap','user_stop']).nullable(),closeout:CloseoutSchema.nullable(),
}).strict().superRefine((s,ctx)=>{
 const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 const invalid=s.identity.roleId!==s.state.roleId||s.policy.roleId!==s.state.roleId||s.baseMemory.roleId!==s.identity.roleId||s.baseMemory.userId!==s.identity.userId||
  s.state.version!==s.turns.length||s.state.observations.length!==s.turns.length||new Set(s.askedQuestionIds).size!==s.askedQuestionIds.length||
  (s.phase==='awaiting_answer')!==(s.current!==null)||(s.current!==null)!==(s.currentIssuedAt!==null)||(s.phase==='completed')!==(s.closeout!==null)||
  ((s.phase==='ready_to_close'||s.phase==='completed')!==(s.pendingReason!==null))||
  (s.phase==='ready_to_close'&&s.pendingReason==='user_stop')||
  !same(s.askedQuestionIds,s.issuedQuestions.map(q=>q.questionId))||
  s.issuedQuestions.some((q,i)=>q.issuedAt<s.state.startedAt||(i>0&&q.issuedAt<s.issuedQuestions[i-1]!.issuedAt))||
  (s.current&&(!s.askedQuestionIds.includes(s.current.question.id)||!same(s.current,s.lastPlan?.selection)||s.currentIssuedAt!==s.issuedQuestions.at(-1)?.issuedAt))||
  s.turns.some((t,i)=>t.input.context.userId!==s.identity.userId||t.input.context.roleId!==s.identity.roleId||
    t.input.state.sessionId!==s.state.sessionId||t.input.expectedVersion!==i||!same(t.input.planningPolicy,s.policy)||
    !s.askedQuestionIds.includes(t.input.question.id)||t.proposal.nextState.version!==i+1||
    (t.proposal.nextState.observations.at(-1)?.observedAt??-1)<(s.issuedQuestions.find(q=>q.questionId===t.input.question.id)?.issuedAt??Infinity))||
  (s.turns.length>0&&!same(s.turns.at(-1)!.proposal.nextState,s.state))||
  (s.closeout&&(s.closeout.requestRevision+1!==s.revision||s.closeout.sessionId!==s.state.sessionId||s.closeout.sessionVersion!==s.state.version||
   s.closeout.report.sessionVersion!==s.state.version||s.closeout.report.sessionId!==s.state.sessionId||
   s.closeout.reflection.sessionId!==s.state.sessionId||!same(s.closeout.reflection.baselinePolicy,s.policy)));
 if(invalid)ctx.addIssue({code:'custom',message:'Workflow phase, identity or version mismatch.'});
});
export const WorkflowCommandSchema=z.object({identity:MemoryIdentitySchema,expectedRevision:z.number().int().nonnegative()}).strict();
export const PlanQuestionCommandSchema=WorkflowCommandSchema.extend({context:ToolContextSchema}).strict();
export const SubmitWorkflowAnswerSchema=WorkflowCommandSchema.extend({context:ToolContextSchema,observationId:id,answer:TurnInputSchema.shape.answer,
 quality:z.number().positive().max(1),speech:SpeechAnswerSchema.optional(),evidenceMode:z.enum(['offline-fixture','live-model','unverified'])}).strict();
export const FinishWorkflowSchema=WorkflowCommandSchema.extend({mode:z.enum(['automatic','user_stop']).default('automatic'),sourceGroupId:id}).strict();
export type InterviewWorkflow=z.infer<typeof WorkflowSchema>;
