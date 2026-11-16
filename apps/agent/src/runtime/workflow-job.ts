import type{z}from'zod';
import type{WorkflowJobSchema}from'../../../../packages/contracts/src/workflow-job.ts';
import type{ToolContext}from'../../../../packages/contracts/src/tools.ts';
import type{AgentRunStageSchema}from'../../../../packages/contracts/src/agent-run.ts';
import type{RunManagerDependencies}from'./run-manager.ts';
import{AgentStateError}from'../planning/interview-state.ts';
import{createInterviewWorkflow,planInterviewQuestion,submitInterviewAnswer,finishInterviewWorkflow,restoreInterviewWorkflow}from'../orchestration/session-workflow.ts';

/** Transport adapter only; snapshots remain business API-owned candidates. */
export async function executeWorkflowJob(job:z.infer<typeof WorkflowJobSchema>,context:ToolContext,deps:RunManagerDependencies,
 signal:AbortSignal,timeoutMs:number,stage:(value:z.infer<typeof AgentRunStageSchema>,message:string)=>void){
 const now=deps.now??Date.now,op=job.operation;
 const check=()=>{if(signal.aborted)throw new AgentStateError('RUN_CANCELLED');if(now()>=context.deadlineAt)throw new AgentStateError('DEADLINE_EXCEEDED');};
 const timing={signal,now,timeoutMs:Math.min(30000,timeoutMs)};check();
 if(op.action==='create'){
  stage('workflow_creating','正在创建会话候选');if(op.config.now>now())throw new AgentStateError('VALIDATION_ERROR');
  const result=createInterviewWorkflow(op.config);check();return result;
 }
 stage(op.action==='restore'?'workflow_restoring':'workflow_validating','正在重验会话快照');
 const snapshot=await restoreInterviewWorkflow(JSON.stringify(op.snapshot),{userId:context.userId,roleId:context.roleId});check();
 if(op.action==='restore')return snapshot;
 if(op.action==='plan'){
  stage('workflow_planning','正在规划会话题目');
  // Host wrap-up needs no model; missing dependency fails only if a query is actually required.
  const plan=deps.planForRole?.(context.roleId)??(async()=>{throw new AgentStateError('DEPENDENCY_UNAVAILABLE');});
  const deliver=deps.deliverForRole?.(context.roleId);
  const result=await planInterviewQuestion(snapshot,op.command,{...timing,plan,...(deliver?{deliver,onPresent:()=>stage('presenting','正在准备会话承接语')}:{} )});check();return result;
 }
 if(op.action==='answer'){
  stage('workflow_evaluating','正在评估会话回答');
  const result=await submitInterviewAnswer(snapshot,op.command,{...timing,evaluate:deps.evaluateForRole(context.roleId),...(deps.onDiagnostic?{onDiagnostic:deps.onDiagnostic}:{})});check();return result;
 }
 stage('workflow_closing','正在生成一致收尾候选');
 const result=await finishInterviewWorkflow(snapshot,op.command,timing);check();return result;
}
