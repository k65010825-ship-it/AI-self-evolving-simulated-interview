import {createInflightClarificationCrash} from './inflight-fixture.ts';
import {fixtureStream} from './fixture.ts';
import {createDurableLiveRunManager} from '../../apps/agent/src/runtime/durable-runtime.ts';
import {createAgentApp} from '../../apps/agent/src/app.ts';
import {createAgentClient,AgentClientError} from '../../packages/agent-client/src/index.ts';
import type {AgentRunEvent} from '../../packages/contracts/src/agent-run.ts';
import type {RoleId} from '../../packages/contracts/src/tools.ts';
import {contentHash} from '../../evals/answers/validation.ts';
const token='http-recovery-synthetic-internal-token-123456';
const codeOf=async(fn:()=>Promise<unknown>)=>{try{await fn();return null;}catch(e){if(e instanceof AgentClientError)return e.code;throw e;}};
export async function runHttpRecoveryAcceptance(role:RoleId){
 const f=await createInflightClarificationCrash(role);let modelAttempts=0,credentialReads=0;
 const initial=createDurableLiveRunManager(f.c,{now:()=>f.now,readCredential:()=>{credentialReads++;throw Error('forbidden');},fetch:async()=>{modelAttempts++;throw Error('forbidden');}},{path:f.database,ownerId:'http-before-reconcile'});
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:createAgentApp({runtime:initial,internalToken:token}).fetch});
 const posts:string[]=[],events:AgentRunEvent[]=[],eventPath='/internal/v1/runs/'+encodeURIComponent(f.crashed.context.runId)+'/events';
 let sseReconnectRequests=0,lastEventIdUsed=false,pendingTemplate:string|undefined,failedExecuteCode:string|null=null,failedExecutePosts=0,blockedExecuteCode:string|null=null,blockedExecutePosts=0,wrongAttemptRejected=false,futureCursorRejected=false,budgetBeforeRestart='';
 try{
  const client=createAgentClient({baseUrl:server.url.origin,internalToken:token,fetch:async(url,init)=>{
   const path=new URL(url).pathname;if(init?.method==='POST')posts.push(path);
   const response=await fetch(url,init);
   if(path===eventPath){sseReconnectRequests++;
    if(sseReconnectRequests===2)lastEventIdUsed=new Headers(init?.headers).get('Last-Event-ID')==='1';
    if(sseReconnectRequests===1){const text=await response.text(),first=text.split(/\r?\n\r?\n/)[0];return new Response(first+'\n\n',{headers:response.headers});}
   }return response;
  }});
  const pending=await client.executeRun(f.first.request);if(pending.result?.kind==='uncommitted-unscored-turn-result')pendingTemplate=pending.result.resolution.clarificationTemplate;
  let before=posts.length;failedExecuteCode=await codeOf(()=>client.executeRun(f.crashed));failedExecutePosts=posts.length-before;
  before=posts.length;blockedExecuteCode=await codeOf(()=>client.executeRun(f.replacement));blockedExecutePosts=posts.length-before;
  for await(const event of client.events(f.crashed.context.runId,{attemptId:f.crashed.context.attemptId,reconnectDelayMs:0,timeoutMs:5000}))events.push(event);
  wrongAttemptRejected=await codeOf(()=>client.getRun(f.crashed.context.runId,{attemptId:'wrong-attempt'}))==='PROTOCOL_ERROR';
  // Use a separate client so the deliberate stream truncation counter remains exact.
  const plain=createAgentClient({baseUrl:server.url.origin,internalToken:token});
  futureCursorRejected=await codeOf(async()=>{for await(const _ of plain.events(f.crashed.context.runId,{attemptId:f.crashed.context.attemptId,afterSeq:initial.snapshot(f.crashed.context.runId).lastEventSeq+1,maxReconnects:0}))void _;})==='VERSION_CONFLICT';
  budgetBeforeRestart=contentHash(initial.modelAccounting());
 }finally{await server.stop(true);initial.close();}
 const preReconcileModelAttempts=modelAttempts,preReconcileCredentialReads=credentialReads;
 let allowed=false,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const restored=createDurableLiveRunManager(f.c,{now:()=>f.now,readCredential:()=>{credentialReads++;if(!allowed)throw Error('forbidden');return 'synthetic-only';},fetch:async()=>{modelAttempts++;if(!allowed)throw Error('forbidden');await gate;return fixtureStream(f.pending.output);}},{path:f.database,ownerId:'http-restored'});
 const again=Bun.serve({hostname:'127.0.0.1',port:0,fetch:createAgentApp({runtime:restored,internalToken:token}).fetch});
 let restartTailMatches=false,restartBudgetMatches=false,newTaskStatus:string|undefined,newTaskEventsObserved=false,newTaskObservations=0,duplicateBudgetUnchanged=false,oldFailedStillFailed=false,totalSyntheticTokens=0;
 try{
  const client=createAgentClient({baseUrl:again.url.origin,internalToken:token,fetch:async(url,init)=>{
   const response=await fetch(url,init);
   if(allowed&&new URL(url).pathname==='/internal/v1/runs/'+encodeURIComponent(f.replacement.context.runId)+'/events'){newTaskEventsObserved=true;queueMicrotask(release);}
   return response;
  }});
  restartBudgetMatches=contentHash(restored.modelAccounting())===budgetBeforeRestart;
  const tail=[];for await(const e of client.events(f.crashed.context.runId,{attemptId:f.crashed.context.attemptId,afterSeq:1,maxReconnects:0}))tail.push(e);
  restartTailMatches=contentHash(tail)===contentHash(events.slice(1));
  const unknown=restored.modelAccounting().find(s=>s.entries.some(e=>e.status==='unknown'))!;
  restored.reconcile({runId:f.crashed.context.runId,attemptId:f.crashed.context.attemptId,identity:{userId:f.crashed.context.userId,roleId:role},expectedVersion:unknown.version,callId:unknown.entries.find(e=>e.status==='unknown')!.callId,usage:{inputTokens:100,outputTokens:30,complete:true},evidenceRef:'synthetic-http-recovery-host-usage'});
  allowed=true;const done=await client.executeRun(f.replacement);newTaskStatus=done.status;
  if(done.result?.kind==='uncommitted-turn-result')newTaskObservations=done.result.proposal.nextState.observations.length;
  const budgets=contentHash(restored.modelAccounting());const duplicate=await client.executeRun(f.replacement);
  duplicateBudgetUnchanged=contentHash(restored.modelAccounting())===budgets&&contentHash(duplicate)===contentHash(done);
  oldFailedStillFailed=(await client.getRun(f.crashed.context.runId,{attemptId:f.crashed.context.attemptId})).status==='failed';
  totalSyntheticTokens=restored.modelAccounting().reduce((sum,s)=>sum+s.totals.usedTokens,0);
 }finally{release();await again.stop(true);restored.close();}
 return {role,output:f.output,transport:'tcp' as const,pendingTemplate,failedExecuteCode,failedExecutePosts,blockedExecuteCode,blockedExecutePosts,sseReconnectRequests,lastEventIdUsed,
  contiguousEvents:events.length>1&&events.every((e,i)=>e.seq===i+1)&&events.at(-1)!.type==='run.failed',restartTailMatches,restartBudgetMatches,wrongAttemptRejected,futureCursorRejected,
  preReconcileModelAttempts,preReconcileCredentialReads,newTaskStatus,newTaskEventsObserved,newTaskObservations,newModelAttempts:modelAttempts-preReconcileModelAttempts,duplicateBudgetUnchanged,oldFailedStillFailed,totalSyntheticTokens,
  liveModelCalls:0 as const,formalCommitted:false as const};
}
