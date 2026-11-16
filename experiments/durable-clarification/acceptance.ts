import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Database} from 'bun:sqlite';
import {createDurableLiveRunManager} from '../../apps/agent/src/runtime/durable-runtime.ts';
import config from '../../apps/agent/src/model-access/bailian.example.json' with {type:'json'};
import type {RoleId} from '../../packages/contracts/src/tools.ts';
import {initialClarificationRequest,continuationRequest,fixtureStream} from './fixture.ts';
import {contentHash} from '../../evals/answers/validation.ts';
import {validateClarificationReceipt} from '../../apps/agent/src/orchestration/clarify-turn.ts';
export async function runDurableClarificationAcceptance(role:RoleId){
 const root=join(process.cwd(),'.cache','durable-clarification');mkdirSync(root,{recursive:true});const output=mkdtempSync(join(root,'run-'));
 const database=join(output,'agent.sqlite'),metrics=join(output,'child-metrics.json'),payload=join(output,'payload.json');
 const c={...config,authorization:{...config.authorization,enabled:true,operatorApproved:true,expiresAt:Date.now()+120000,maxRuns:8}};
 const f=initialClarificationRequest(role);writeFileSync(payload,JSON.stringify({config:c,request:f.request,output:f.output,database,metrics}));
 const child=Bun.spawn([process.execPath,'--no-env-file',resolve('experiments/durable-clarification/child.ts'),payload],{cwd:process.cwd(),stdout:'ignore',stderr:'pipe'});
 const timeout=setTimeout(()=>child.kill(),15000);let childExitCode:number;
 try{childExitCode=await child.exited;}finally{clearTimeout(timeout);}
 if(childExitCode!==0)throw Error('DURABLE_CLARIFICATION_CHILD_FAILED');
 const childMetrics=JSON.parse(readFileSync(metrics,'utf8')) as {httpAttempts:number;credentialReads:number;resultDigest:string;eventsDigest:string;budgetsDigest:string};
 let replayCredentialReads=0,replayHttpAttempts=0;
 const replay=createDurableLiveRunManager(config,{readCredential:()=>{replayCredentialReads++;throw Error('forbidden');},fetch:async()=>{replayHttpAttempts++;throw Error('forbidden');}},{path:database,ownerId:'replay'});
 let old:ReturnType<typeof replay.snapshot>,oldBudget:ReturnType<typeof replay.modelAccounting>[number],exactResultReplay=false,exactEventReplay=false,exactBudgetReplay=false;
 try{
  old=replay.snapshot(f.request.context.runId);oldBudget=replay.modelAccounting()[0]!;
  exactResultReplay=contentHash(replay.start(f.request))===contentHash(old)&&contentHash(old)===childMetrics.resultDigest;
  const events=[];for await(const e of replay.events(f.request.context.runId))events.push(e);
  const tail=[];for await(const e of replay.events(f.request.context.runId,1))tail.push(e);
  exactEventReplay=contentHash(events)===childMetrics.eventsDigest&&events.length===old.lastEventSeq&&contentHash(tail)===contentHash(events.slice(1))&&events.some(e=>e.type==='answer.resolution');
  exactBudgetReplay=contentHash(replay.modelAccounting())===childMetrics.budgetsDigest&&contentHash(oldBudget)===contentHash(replay.modelAccounting()[0]);
 }finally{replay.close();}
 if(old.result?.kind!=='uncommitted-unscored-turn-result'||old.result.resolution.status!=='needs_clarification'||f.request.job.type!=='turn')throw Error('DURABLE_CLARIFICATION_RESULT_INVALID');
 const receipt=old.result.resolution;validateClarificationReceipt(f.request.job.input,receipt);
 const next=continuationRequest(f.request,receipt);let continuationHttpAttempts=0;
 const continued=createDurableLiveRunManager(c,{readCredential:()=> 'synthetic-only',fetch:async()=>{continuationHttpAttempts++;return fixtureStream(next.output);}},{path:database,ownerId:'continued'});
 let continuationStatus:string,observations=0,normalizedScore:number|null=null,duplicateContinuationReplay=false,rewriteStatus:string,rewriteError:string|null=null,changedRequestRejected=false,totalSettledTokens=0,budgetRows=0,originalBudgetUnchanged=false;
 try{
  continued.start(next.request);await continued.wait(next.request.context.runId);const done=continued.snapshot(next.request.context.runId);continuationStatus=done.status;
  if(done.result?.kind==='uncommitted-turn-result'){observations=done.result.proposal.nextState.observations.length;normalizedScore=done.result.proposal.evaluation.normalizedScore;}
  const budgetsBeforeReplay=contentHash(continued.modelAccounting());
  duplicateContinuationReplay=contentHash(continued.start(next.request))===contentHash(done)&&contentHash(continued.modelAccounting())===budgetsBeforeReplay;
  try{continued.start({...next.request,inputSnapshotId:'changed'});}catch(e){changedRequestRejected=e instanceof Error&&e.message==='VERSION_CONFLICT';}
  if(next.request.job.type!=='turn')throw Error('DURABLE_CLARIFICATION_FIXTURE_INVALID');
  const context={...next.request.context,runId:next.request.context.runId+'-rewrite',attemptId:'rewrite'};
  const bad={...next.request,inputSnapshotId:context.runId,context,job:{...next.request.job,input:{...next.request.job.input,context,answer:{id:'rewrite-answer',text:'替换原回答，而非追加。'}}}};
  continued.start(bad);await continued.wait(context.runId);const rejected=continued.snapshot(context.runId);rewriteStatus=rejected.status;rewriteError=rejected.error?.code??null;
  const budgets=continued.modelAccounting();budgetRows=budgets.length;totalSettledTokens=budgets.reduce((sum,s)=>sum+s.totals.usedTokens,0);
  originalBudgetUnchanged=budgets.some(b=>contentHash(b)===contentHash(oldBudget));
 }finally{continued.close();}
 const db=new Database(database,{readonly:true});let authorizationRunsUsed:number;
 try{authorizationRunsUsed=(db.query('SELECT SUM(used_runs) AS n FROM agent_authorizations').get() as {n:number}).n;}finally{db.close();}
 return {role,output,childExitCode,template:receipt.clarificationTemplate,childHttpAttempts:childMetrics.httpAttempts,childCredentialReads:childMetrics.credentialReads,
  exactResultReplay,exactEventReplay,exactBudgetReplay,replayCredentialReads,replayHttpAttempts,continuationStatus,observations,normalizedScore,continuationHttpAttempts,
  duplicateContinuationReplay,rewriteStatus,rewriteError,changedRequestRejected,totalSettledTokens,budgetRows,originalBudgetUnchanged,authorizationRunsUsed,
  liveModelCalls:0 as const,formalCommitted:false as const};
}
