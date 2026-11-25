import{z}from'zod';
import{CreateInterviewStateSchema,InterviewStateSchema}from'./interview-state.ts';
import{MemoryIdentitySchema,MemorySnapshotSchema}from'./memory.ts';
import{PlanningPolicyVersionSchema}from'./policy.ts';
import{ReportInputSchema,ContentReportSchema}from'./report.ts';
import{ReflectionSchema}from'./reflection.ts';
import{PlannerResultSchema}from'./knowledge-planner.ts';
import{QuestionSelectionSchema,ExecutedQuestionPlanSchema}from'./question-selection.ts';
import {KnowledgeCatalogPinSchema} from './knowledge-catalog.ts';
import{ToolContextSchema}from'./tools.ts';
import{TurnInputSchema}from'./evaluation.ts';
import{SpeechAnswerSchema}from'./speech.ts';
import{QuestionDeliverySchema}from'./question-delivery.ts';
import{WorkflowClarificationAttemptSchema}from'./workflow-clarification.ts';
import {HintAssistanceSchema,isAssistanceContinuation} from './hints.ts';
const id=z.string().min(1).max(100);
const selected=QuestionSelectionSchema.options[2];
export const IssuedQuestionContentSchema=z.object({question:TurnInputSchema.shape.question,rubric:selected.shape.rubric,source:selected.shape.source,
 text:z.string().min(1).max(4200),stateVersion:z.number().int().nonnegative(),policyId:id,
  planRunId:ToolContextSchema.shape.runId,planAttemptId:ToolContextSchema.shape.attemptId,delivery:QuestionDeliverySchema.optional(),
  effectivePlan:ExecutedQuestionPlanSchema.omit({questionId:true,issuedAt:true}).optional()}).strict().superRefine((c,ctx)=>{
 const d=c.delivery,b=d?.basedOn,same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 if(c.question.id!==c.source.knowledgeId||c.rubric.id!==c.question.id||c.rubric.roleId!==c.question.roleId||c.rubric.version!==c.source.version
  ||c.text!==(d?.text??c.question.text)||d&&(!same(d.question,c.question)||b!.stateVersion!==c.stateVersion||b!.runId!==c.planRunId||b!.attemptId!==c.planAttemptId
   ||b!.rubricId!==c.rubric.id||b!.rubricVersion!==c.rubric.version||b!.sourceVersion!==c.source.version))ctx.addIssue({code:'custom',message:'Issued content binding mismatch.'});
});
export const IssuedQuestionRecordSchema=z.object({questionId:id,issuedAt:z.number().int().nonnegative(),content:IssuedQuestionContentSchema.optional()}).strict();
export const CreateWorkflowSchema=z.object({identity:MemoryIdentitySchema,session:CreateInterviewStateSchema,policy:PlanningPolicyVersionSchema,
 goal:z.string().min(1).max(500),skillLabels:ReportInputSchema.shape.skillLabels,memory:MemorySnapshotSchema.optional(),
  allowDraftKnowledge:z.boolean().default(false),catalogPin:KnowledgeCatalogPinSchema.optional(),now:z.number().int().nonnegative()}).strict();
export const CloseoutSchema=z.object({kind:z.literal('uncommitted-interview-closeout'),sessionId:id,sessionVersion:z.number().int().nonnegative(),
 generatedAt:z.number().int().nonnegative(),sourceGroupId:id,requestRevision:z.number().int().nonnegative(),requestMode:z.enum(['automatic','user_stop']),reason:z.enum(['plan_finished','knowledge_gap','user_stop']),
 report:ContentReportSchema,memoryCandidate:MemorySnapshotSchema,memoryDisposition:z.enum(['appended','unchanged_no_answers']),reflection:ReflectionSchema}).strict();
export const WorkflowSchema=z.object({kind:z.literal('uncommitted-interview-session'),revision:z.number().int().nonnegative(),
 identity:MemoryIdentitySchema,state:InterviewStateSchema,policy:PlanningPolicyVersionSchema,goal:z.string().min(1).max(500),
  skillLabels:ReportInputSchema.shape.skillLabels,baseMemory:MemorySnapshotSchema,allowDraftKnowledge:z.boolean(),catalogPin:KnowledgeCatalogPinSchema.optional(),
 phase:z.enum(['ready_to_plan','awaiting_answer','ready_to_close','completed']),
 turns:ReportInputSchema.shape.turns,clarificationAttempts:z.array(WorkflowClarificationAttemptSchema).max(600).optional(),askedQuestionIds:z.array(id).max(200),
 issuedQuestions:z.array(IssuedQuestionRecordSchema).max(200),
 hintAssistance:z.array(z.object({questionId:id,assistance:HintAssistanceSchema}).strict()).max(200).optional(),
 current:QuestionSelectionSchema.options[2].nullable(),currentIssuedAt:z.number().int().nonnegative().nullable(),lastPlan:PlannerResultSchema.nullable(),
 pendingReason:z.enum(['plan_finished','knowledge_gap','user_stop']).nullable(),closeout:CloseoutSchema.nullable(),
}).strict().superRefine((s,ctx)=>{
 const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 let invalid=s.identity.roleId!==s.state.roleId||s.policy.roleId!==s.state.roleId||s.baseMemory.roleId!==s.identity.roleId||s.baseMemory.userId!==s.identity.userId||
  s.state.version!==s.turns.length||s.state.observations.length!==s.turns.length||new Set(s.askedQuestionIds).size!==s.askedQuestionIds.length||
  (s.phase==='awaiting_answer')!==(s.current!==null)||(s.current!==null)!==(s.currentIssuedAt!==null)||(s.phase==='completed')!==(s.closeout!==null)||
  ((s.phase==='ready_to_close'||s.phase==='completed')!==(s.pendingReason!==null))||
  (s.phase==='ready_to_close'&&s.pendingReason==='user_stop')||
  !same(s.askedQuestionIds,s.issuedQuestions.map(q=>q.questionId))||
  s.issuedQuestions.some((q,i)=>q.issuedAt<s.state.startedAt||(i>0&&q.issuedAt<s.issuedQuestions[i-1]!.issuedAt))||
  (s.current&&(!s.askedQuestionIds.includes(s.current.question.id)||s.current.question.id!==s.issuedQuestions.at(-1)?.questionId||!same(s.current,s.lastPlan?.selection)||s.currentIssuedAt!==s.issuedQuestions.at(-1)?.issuedAt))||
  s.turns.some((t,i)=>t.input.context.userId!==s.identity.userId||t.input.context.roleId!==s.identity.roleId||
    t.input.state.sessionId!==s.state.sessionId||t.input.expectedVersion!==i||!same(t.input.planningPolicy,s.policy)||
    !s.askedQuestionIds.includes(t.input.question.id)||t.proposal.nextState.version!==i+1||
    (t.proposal.nextState.observations.at(-1)?.observedAt??-1)<(s.issuedQuestions.find(q=>q.questionId===t.input.question.id)?.issuedAt??Infinity))||
  (s.turns.length>0&&!same(s.turns.at(-1)!.proposal.nextState,s.state))||
  (s.closeout&&(s.closeout.requestRevision+1!==s.revision||s.closeout.sessionId!==s.state.sessionId||s.closeout.sessionVersion!==s.state.version||
   s.closeout.report.sessionVersion!==s.state.version||s.closeout.report.sessionId!==s.state.sessionId||
   s.closeout.reflection.sessionId!==s.state.sessionId||!same(s.closeout.reflection.baselinePolicy,s.policy)));
 if(new Set(s.hintAssistance?.map(h=>h.questionId)).size!==(s.hintAssistance?.length??0)||s.hintAssistance?.some(h=>!s.askedQuestionIds.includes(h.questionId)))invalid=true;
 for(const h of s.hintAssistance??[]){const turn=s.turns.find(t=>t.input.question.id===h.questionId);
  if(turn&&!same(turn.input.assistance,h.assistance)||(s.clarificationAttempts??[]).some(t=>t.input.question.id===h.questionId&&!isAssistanceContinuation(t.input.assistance,h.assistance)))invalid=true;
 }
 for(const[qIndex,issued]of s.issuedQuestions.entries()){
  const c=issued.content,t=s.turns.find(t=>t.input.question.id===issued.questionId);
  if(!c){if(t?.input.presentedText!==undefined)invalid=true;continue;}
  const preceding=s.turns.filter(t=>s.askedQuestionIds.indexOf(t.input.question.id)<qIndex);
  if(c.question.id!==issued.questionId||c.question.roleId!==s.identity.roleId||c.policyId!==s.policy.id||c.stateVersion!==preceding.length)invalid=true;
  if(t&&(t.input.expectedVersion!==c.stateVersion||!same(t.input.question,c.question)||!same(t.input.rubric,c.rubric)||t.input.presentedText!==c.text))invalid=true;
  if(s.current?.question.id===issued.questionId&&(!same(s.current.question,c.question)||!same(s.current.rubric,c.rubric)||!same(s.current.source,c.source)))invalid=true;
  if(c.delivery){const prev=preceding.at(-1),b=c.delivery.basedOn,e=c.delivery.excerpt;
   if(!prev||b.sessionId!==s.state.sessionId||b.previousAnswerId!==prev.input.answer.id||e!==null&&(prev.input.answer.text.indexOf(e)<0||prev.input.answer.text.indexOf(e)!==prev.input.answer.text.lastIndexOf(e)))invalid=true;
  }
 }
 if(invalid)ctx.addIssue({code:'custom',message:'Workflow phase, identity or version mismatch.'});
});
export const WorkflowCommandSchema=z.object({identity:MemoryIdentitySchema,expectedRevision:z.number().int().nonnegative()}).strict();
export const PlanQuestionCommandSchema=WorkflowCommandSchema.extend({context:ToolContextSchema}).strict();
export const SubmitWorkflowAnswerSchema=WorkflowCommandSchema.extend({context:ToolContextSchema,observationId:id,answer:TurnInputSchema.shape.answer,
 assistance:TurnInputSchema.shape.assistance,quality:z.number().positive().max(1),speech:SpeechAnswerSchema.optional(),evidenceMode:z.enum(['offline-fixture','live-model','unverified'])}).strict();
export const FinishWorkflowSchema=WorkflowCommandSchema.extend({mode:z.enum(['automatic','user_stop']).default('automatic'),sourceGroupId:id}).strict();
export type InterviewWorkflow=z.infer<typeof WorkflowSchema>;
