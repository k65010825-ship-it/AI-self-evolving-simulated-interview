import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createWorkflowFixture} from '../../experiments/session/fixture.ts';
import {createRunManager} from '../../apps/agent/src/runtime/run-manager.ts';
import {createAgentApp} from '../../apps/agent/src/app.ts';
import {createAgentClient} from '../../packages/agent-client/src/index.ts';
import {createMemory,restoreMemory} from '../../apps/agent/src/memory/session-memory.ts';
import {createFeedbackRevisionHistory,proposeFeedbackRevision} from '../../packages/interview-domain/src/feedback-revision.ts';
import {closeoutSnapshotDigest} from '../../apps/agent/src/reporting/closeout-preview.ts';
import type {RoleId,ToolContext} from '../../packages/contracts/src/tools.ts';
import type {AgentRunRequest,AgentRunSnapshot,AgentRunEvent} from '../../packages/contracts/src/agent-run.ts';
import type {WorkflowOperation} from '../../packages/contracts/src/workflow-job.ts';
import type {InterviewWorkflow} from '../../packages/contracts/src/session-workflow.ts';
import {contentHash} from '../answers/validation.ts';

/** A single coherent fixture journey. Candidate adoption here is not a business commit. */
export async function runAgentJourneyCase(roleId:RoleId,directory:string){
 const fixture=await createWorkflowFixture(roleId,{delivery:true,injectInvalidEvaluationOnce:true});
 const identity={userId:'journey-fixture',roleId};let floor=Date.now(),counter=0;
 const now=()=>Math.max(Date.now(),floor);
 const runtime=createRunManager({now,evaluateForRole:()=>fixture.evaluate,planForRole:()=>fixture.plan,deliverForRole:()=>fixture.deliver!,previewEditorsFor:()=>['synthetic-journey-editor']});
 const token=randomBytes(32).toString('hex'),app=createAgentApp({runtime,internalToken:token}),server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:app.fetch});
 const client=createAgentClient({baseUrl:`http://127.0.0.1:${server.port}`,internalToken:token});
 const trace:{step:string;requestDigest:string;runDigest:string;runId:string;status:AgentRunSnapshot['status'];events:AgentRunEvent[]}[]=[];
 const call=async(step:string,build:(context:ToolContext)=>AgentRunRequest['job'],allowFailure=false)=>{
  const runId=`journey-${roleId}-${++counter}`,context={...identity,runId,attemptId:'a',deadlineAt:now()+60000};
  const request:AgentRunRequest={inputSnapshotId:runId,context,job:build(context)};
  await client.startRun(request);const events=[];for await(const e of client.events(runId,{attemptId:'a'}))events.push(e);
  const run=await client.getRun(runId,{attemptId:'a'});
  trace.push({step,requestDigest:contentHash(request),runDigest:contentHash(run),runId,status:run.status,events});
  if(!allowFailure&&run.status!=='completed')throw Error('AGENT_JOURNEY_EXECUTION_FAILED');return{request,run};
 };
 const workflow=async(step:string,build:(c:ToolContext)=>WorkflowOperation)=>{
  const r=await call(step,c=>({type:'workflow',operation:build(c)}));
  if(r.run.result?.kind!=='uncommitted-workflow-result')throw Error('AGENT_JOURNEY_EXECUTION_FAILED');return r.run.result.snapshot;
 };
 try{
  const create=(sessionId:string,memory:ReturnType<typeof createMemory>,second=false)=>{
   const extra=roleId==='java-backend'?'java-concurrency':'javascript';
   return {identity,session:{sessionId,roleId,durationMinutes:20,skills:second?[{skillId:'project-design',relevance:.8},{skillId:'collaboration',relevance:.79},{skillId:extra,relevance:1}]:[{skillId:'project-design',relevance:1},{skillId:'collaboration',relevance:.99}]},
    memory,policy:{id:second?'journey-second-policy':'journey-first-policy',roleId,parameters:{maxFollowupDepth:0,maxTurns:second?1:2,wrapUpSeconds:30}},
    goal:'双岗离线主流程联调，不证明教学质量',skillLabels:second?{'project-design':'项目论证',collaboration:'协作', [extra]:'新增技术技能'}:{'project-design':'项目论证',collaboration:'协作'},allowDraftKnowledge:true,now:now()};
  };
  let first=await workflow('first.create',()=>({action:'create',config:create('journey-first-'+roleId,createMemory(identity,now()))}));
  first=await workflow('first.plan0',context=>({action:'plan',snapshot:first,command:{identity,expectedRevision:first.revision,context}}));
  const beforeFailure=structuredClone(first);
  const answer=(s:InterviewWorkflow,context:ToolContext,index:number)=>({action:'answer' as const,snapshot:s,command:{identity,expectedRevision:s.revision,context,
   observationId:'first-o'+index,answer:{id:'first-a'+index,text:index===0?'这是合成项目案例，我先分析约束、原子边界和验证步骤，未验证线上效果。':'下面是假设团队案例，我先确认影响再协商行动与验收。'},quality:.8,evidenceMode:'offline-fixture' as const}});
  const failed=await call('first.answer0.failed',context=>({type:'workflow',operation:answer(first,context,0)}),true);
  if(failed.run.status!=='failed')throw Error('AGENT_JOURNEY_FAULT_NOT_OBSERVED');
  const afterFailure=structuredClone(first),callsBeforeReplay=fixture.stats.scoring.providerCalls;
  const replayedFailure=await client.startRun(failed.request),callsAfterReplay=fixture.stats.scoring.providerCalls;
  const retry=await call('first.answer0.retry',context=>({type:'workflow',operation:answer(first,context,0)}));
  if(retry.run.result?.kind!=='uncommitted-workflow-result')throw Error('AGENT_JOURNEY_EXECUTION_FAILED');first=retry.run.result.snapshot;
  first=await workflow('first.plan1',context=>({action:'plan',snapshot:first,command:{identity,expectedRevision:first.revision,context}}));
  first=await workflow('first.answer1',context=>answer(first,context,1));
  first=await workflow('first.finish',()=>({action:'finish',snapshot:first,command:{identity,expectedRevision:first.revision,mode:'automatic',sourceGroupId:'journey-first-group'}}));
  const memory=first.closeout!.memoryCandidate,memoryPath=join(directory,roleId+'.memory.json');
  await writeFile(memoryPath,JSON.stringify(memory,null,2)+'\n',{flag:'wx'});const restoredMemory=restoreMemory(await readFile(memoryPath,'utf8'),identity);
  floor=Math.max(now(),restoredMemory.updatedAt+1);
  let second=await workflow('second.create',()=>({action:'create',config:create('journey-second-'+roleId,restoredMemory,true)}));
  const secondCreated=structuredClone(second);
  second=await workflow('second.plan',context=>({action:'plan',snapshot:second,command:{identity,expectedRevision:second.revision,context}}));
  second=await workflow('second.answer',context=>({action:'answer',snapshot:second,command:{identity,expectedRevision:second.revision,context,observationId:'second-o',
   answer:{id:'second-a',text:roleId==='java-backend'?'这是合成回答：区分可见性与原子性，并核对边界条件；未验证真实系统。':'这是合成回答：闭包需考虑变量读取时机；未验证真实用户效果。'},quality:.8,evidenceMode:'offline-fixture'}}));
  second=await workflow('second.finish',()=>({action:'finish',snapshot:second,command:{identity,expectedRevision:second.revision,mode:'automatic',sourceGroupId:'journey-second-group'}}));
  const sourceDigest=closeoutSnapshotDigest(second),t=second.turns[0]!;
  let history=createFeedbackRevisionHistory(t.input,t.proposal);
  history=proposeFeedbackRevision(t.input,t.proposal,history,{requestId:'journey-revision',expectedVersion:0,expectedHeadDigest:history.headSourceDigest,
   feedback:{strengths:[],improvements:['在相同条件下补充验证步骤；此处是合成修订草案']},note:'AI-authored fixture, not expert review'},
   {...identity,sessionId:second.state.sessionId,editorId:'synthetic-journey-editor',authorizedEditorIds:['synthetic-journey-editor'],now:now()}).history;
  const providerCallsBeforePreview=fixture.stats.planning.providerCalls+fixture.stats.scoring.providerCalls+(fixture.stats.delivery?.providerCalls??0);
  const preview=await call('second.preview',()=>({type:'closeout-preview',input:{snapshot:second,expectedSnapshotDigest:sourceDigest,selections:[{answerId:t.input.answer.id,history,version:1}]}}));
  const sdkReplay=await client.executeRun(preview.request);
  const providerCallsAfterPreview=fixture.stats.planning.providerCalls+fixture.stats.scoring.providerCalls+(fixture.stats.delivery?.providerCalls??0);
  return {version:1 as const,mode:'offline-agent-journey-case' as const,roleId,identity,first,second,secondCreated,
   failure:{...failed,before:beforeFailure,after:afterFailure,replayed:replayedFailure,callsBeforeReplay,callsAfterReplay},retry,
   history,preview,previewSdkReplayDigest:contentHash(sdkReplay),sourceDigestBeforePreview:sourceDigest,sourceDigestAfterPreview:closeoutSnapshotDigest(second),
   providerCallsBeforePreview,providerCallsAfterPreview,trace,
   stats:{planningProviderCalls:fixture.stats.planning.providerCalls,scoringProviderCalls:fixture.stats.scoring.providerCalls,deliveryProviderCalls:fixture.stats.delivery?.providerCalls??0,
    injectedInvalidEvaluations:fixture.stats.faults.injectedInvalidEvaluations,liveModelCalls:fixture.stats.planning.liveModelCalls+fixture.stats.scoring.liveModelCalls+(fixture.stats.delivery?.liveModelCalls??0)},
   formalCommitted:false as const,humanReferenceCount:0 as const,qualityClaimEligible:false as const};
 }finally{runtime.dispose();server.stop(true);}
}
