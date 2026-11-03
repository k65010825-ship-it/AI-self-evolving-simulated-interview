import{z}from'zod';
import{CreateWorkflowSchema,WorkflowSchema,PlanQuestionCommandSchema,SubmitWorkflowAnswerSchema,FinishWorkflowSchema}from'./session-workflow.ts';
export const WorkflowActionSchema=z.enum(['create','plan','answer','finish','restore']);
export const WorkflowOperationSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),config:CreateWorkflowSchema}).strict(),
 z.object({action:z.literal('plan'),snapshot:WorkflowSchema,command:PlanQuestionCommandSchema}).strict(),
 z.object({action:z.literal('answer'),snapshot:WorkflowSchema,command:SubmitWorkflowAnswerSchema}).strict(),
 z.object({action:z.literal('finish'),snapshot:WorkflowSchema,command:FinishWorkflowSchema}).strict(),
 z.object({action:z.literal('restore'),snapshot:WorkflowSchema}).strict(),
]);
export const WorkflowJobSchema=z.object({type:z.literal('workflow'),operation:WorkflowOperationSchema}).strict();
export const WorkflowJobResultSchema=z.object({kind:z.literal('uncommitted-workflow-result'),action:WorkflowActionSchema,snapshot:WorkflowSchema}).strict();
export type WorkflowOperation=z.infer<typeof WorkflowOperationSchema>;
