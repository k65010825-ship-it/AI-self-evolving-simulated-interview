import{z}from'zod';
import{ToolContextSchema,KnowledgeItemSchema,ErrorCodeSchema}from'./tools.ts';
import{TurnInputSchema,TurnProposalSchema}from'./evaluation.ts';
import{ReportInputSchema,ContentReportSchema}from'./report.ts';
import{QuestionSelectionSchema}from'./question-selection.ts';
import{PlannerResultSchema}from'./knowledge-planner.ts';
import{WorkflowJobSchema,WorkflowJobResultSchema,WorkflowActionSchema}from'./workflow-job.ts';
import{WorkflowSchema}from'./session-workflow.ts';
import{WorkflowRsiInputSchema,WorkflowRsiResultSchema,WorkflowRsiStatusSchema}from'./workflow-rsi.ts';
import{ClarificationOptionsSchema,UnscoredTurnSchema}from'./clarification.ts';
import{QuestionDeliverySchema}from'./question-delivery.ts';
import{CloseoutPreviewInputSchema,CloseoutPreviewSchema}from'./closeout-preview.ts';
const id=z.string().min(1).max(100);
export const AgentRunRequestSchema=z.object({inputSnapshotId:id,context:ToolContextSchema,
 job:z.discriminatedUnion('type',[
  z.object({type:z.literal('turn'),input:TurnInputSchema,knowledge:z.array(KnowledgeItemSchema).max(500),
   askedQuestionIds:z.array(id).max(200),allowDraftKnowledge:z.boolean().default(false),clarification:ClarificationOptionsSchema.optional()}).strict(),
  z.object({type:z.literal('report'),input:ReportInputSchema}).strict(),
  z.object({type:z.literal('closeout-preview'),input:CloseoutPreviewInputSchema}).strict(),
  WorkflowJobSchema,
  z.object({type:z.literal('rsi'),input:WorkflowRsiInputSchema}).strict(),
 ])}).strict().superRefine((r,ctx)=>{
 let invalid=false;
 if(r.job.type==='turn')invalid=JSON.stringify(r.context)!==JSON.stringify(r.job.input.context);
 if(r.job.type==='report')invalid=r.context.roleId!==r.job.input.state.roleId||r.job.input.turns.some(t=>t.input.context.userId!==r.context.userId);
 if(r.job.type==='closeout-preview')invalid=r.context.roleId!==r.job.input.snapshot.identity.roleId||r.context.userId!==r.job.input.snapshot.identity.userId;
 if(r.job.type==='workflow'){
  const op=r.job.operation,identity=op.action==='create'?op.config.identity:op.snapshot.identity;
  invalid=identity.userId!==r.context.userId||identity.roleId!==r.context.roleId;
  if(op.action==='plan'||op.action==='answer')invalid||=JSON.stringify(op.command.context)!==JSON.stringify(r.context);
  if(op.action==='plan'||op.action==='answer'||op.action==='finish')
   invalid||=op.command.identity.userId!==r.context.userId||op.command.identity.roleId!==r.context.roleId;
 }
 if(r.job.type==='rsi'){
  const i=r.job.input;invalid=i.identity.userId!==r.context.userId||i.identity.roleId!==r.context.roleId||
   i.snapshot.identity.userId!==r.context.userId||i.snapshot.identity.roleId!==r.context.roleId||i.registry.roleId!==r.context.roleId;
 }
 if(invalid)ctx.addIssue({code:'custom',message:'Run and job context mismatch.'});
});
export const AgentRunResultSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('uncommitted-turn-result'),proposal:TurnProposalSchema,selection:QuestionSelectionSchema,planning:PlannerResultSchema.optional(),delivery:QuestionDeliverySchema.optional()}).strict().superRefine((r,ctx)=>{
  const d=r.delivery;if(!d)return;const b=d.basedOn,p=r.proposal;
  if(r.selection.status!=='selected'||JSON.stringify(d.question)!==JSON.stringify(r.selection.question)||b.runId!==p.basedOn.runId||b.attemptId!==p.basedOn.attemptId
   ||b.sessionId!==p.nextState.sessionId||b.stateVersion!==p.nextState.version||b.previousAnswerId!==p.basedOn.answerId||b.rubricId!==r.selection.rubric.id
   ||b.rubricVersion!==r.selection.rubric.version||b.sourceVersion!==r.selection.source.version)ctx.addIssue({code:'custom',message:'Delivery result binding mismatch.'});
 }),
 z.object({kind:z.literal('uncommitted-unscored-turn-result'),resolution:UnscoredTurnSchema,selection:QuestionSelectionSchema.optional()}).strict().superRefine((r,ctx)=>{
  if((r.resolution.status==='abstained')!==(r.selection!==undefined))ctx.addIssue({code:'custom',message:'Only abstention may select the next question.'});
 }),
 z.object({kind:z.literal('uncommitted-report-result'),report:ContentReportSchema}).strict(),
 CloseoutPreviewSchema,
 WorkflowJobResultSchema,
 WorkflowRsiResultSchema,
]);
export const AgentRunErrorSchema=z.object({code:ErrorCodeSchema,message:z.string(),retryable:z.boolean()}).strict();
export const AgentRunStageSchema=z.enum(['queued','evaluating','selecting','presenting','reporting','closeout_preview','workflow_validating','workflow_creating','workflow_planning','workflow_evaluating','workflow_closing','workflow_restoring','rsi_evaluating']);
const envelope=z.object({schemaVersion:z.literal(1),runId:z.string().min(1),attemptId:z.string().min(1),seq:z.number().int().positive(),occurredAt:z.iso.datetime()});
export const AgentRunEventSchema=z.discriminatedUnion('type',[
 envelope.extend({type:z.literal('run.accepted'),payload:z.object({stage:z.literal('queued')}).strict()}).strict(),
 envelope.extend({type:z.literal('run.stage'),payload:z.object({stage:AgentRunStageSchema,message:z.string()}).strict()}).strict(),
 envelope.extend({type:z.literal('question.completed'),payload:z.object({question:TurnInputSchema.shape.question,delivery:QuestionDeliverySchema.optional()}).strict()}).strict().superRefine((e,ctx)=>{
  const d=e.payload.delivery;if(d&&(JSON.stringify(d.question)!==JSON.stringify(e.payload.question)||d.basedOn.runId!==e.runId||d.basedOn.attemptId!==e.attemptId))
   ctx.addIssue({code:'custom',message:'Delivery event binding mismatch.'});
 }),
 envelope.extend({type:z.literal('answer.resolution'),payload:z.object({status:UnscoredTurnSchema.shape.status,questionId:id,answerId:id,
  clarification:UnscoredTurnSchema.shape.clarification,reason:UnscoredTurnSchema.shape.reason,attempt:UnscoredTurnSchema.shape.attempt,
  missingCriterionIds:UnscoredTurnSchema.shape.missingCriterionIds}).strict()}).strict(),
 envelope.extend({type:z.literal('workflow.updated'),payload:z.object({action:WorkflowActionSchema,sessionId:z.string().min(1),revision:z.number().int().nonnegative(),
  phase:WorkflowSchema.shape.phase,stateVersion:z.number().int().nonnegative()}).strict()}).strict(),
 envelope.extend({type:z.literal('rsi.completed'),payload:z.object({sessionId:z.string().min(1),experimentId:z.string().min(1),status:WorkflowRsiStatusSchema,
  registryVersion:z.number().int().nonnegative(),evidenceMode:z.literal('synthetic'),productionPublished:z.literal(false),
  baselineAgreement:z.number().min(0).max(1).nullable(),candidateAgreement:z.number().min(0).max(1).nullable(),delta:z.number().min(-1).max(1).nullable()}).strict()}).strict(),
 envelope.extend({type:z.literal('run.completed'),payload:z.object({resultKind:z.enum(['uncommitted-turn-result','uncommitted-unscored-turn-result','uncommitted-report-result','uncommitted-workflow-result','uncommitted-workflow-rsi','uncommitted-closeout-preview']),committed:z.literal(false)}).strict()}).strict(),
 envelope.extend({type:z.literal('run.failed'),payload:z.object({error:AgentRunErrorSchema}).strict()}).strict(),
 envelope.extend({type:z.literal('run.cancelled'),payload:z.object({reason:z.literal('host_cancelled')}).strict()}).strict(),
]);
export const AgentRunSnapshotSchema=z.object({runId:z.string().min(1),attemptId:z.string().min(1),inputSnapshotId:id,
 status:z.enum(['queued','running','completed','failed','cancelled']),stage:AgentRunStageSchema.nullable(),
 createdAt:z.iso.datetime(),updatedAt:z.iso.datetime(),lastEventSeq:z.number().int().nonnegative(),
 error:AgentRunErrorSchema.nullable(),result:AgentRunResultSchema.nullable()}).strict().superRefine((s,ctx)=>{
 if((s.status==='completed')!==(s.result!==null))ctx.addIssue({code:'custom',message:'Only completed runs have a result.'});
});
export const AgentRunCancelSchema=z.object({attemptId:z.string().min(1)}).strict();
export type AgentRunRequest=z.infer<typeof AgentRunRequestSchema>;
export type AgentRunResult=z.infer<typeof AgentRunResultSchema>;
export type AgentRunEvent=z.infer<typeof AgentRunEventSchema>;
export type AgentRunSnapshot=z.infer<typeof AgentRunSnapshotSchema>;
