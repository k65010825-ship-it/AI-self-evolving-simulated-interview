import{pathToFileURL}from'node:url';
import{mkdirSync,mkdtempSync,readdirSync,unlinkSync,rmdirSync}from'node:fs';import{join}from'node:path';
import{createDurableLiveRunManager}from'../apps/agent/src/runtime/durable-runtime.ts';
import{acceptanceSample}from'../evals/live-bailian/samples.ts';
import config from'../apps/agent/src/model-access/bailian.example.json'with{type:'json'};
import type{RoleId}from'../packages/contracts/src/tools.ts';
import{workflowCommitDigest as digest}from'../packages/agent-client/src/workflow-commit.ts';
import{contentText}from'../experiments/pi-sdk/planner-fixture.ts';
/** Actual SQLite reopen; injected transport failure and host-supplied synthetic reconciliation, not vendor billing. */
export async function runDurableRuntimeDemo(roleId:RoleId='java-backend',options:{retain?:boolean}={}){
 const root=join(process.cwd(),'.cache');mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'durable-demo-')),path=join(dir,'agent.sqlite');
 const c={...config,authorization:{...config.authorization,enabled:true,operatorApproved:true,expiresAt:Date.now()+60000}};
 const make=(id:string)=>{const now=Date.now(),r=acceptanceSample(roleId,now,now+60000);r.context.runId=id;r.job.type==='turn'&&(r.job.input.context.runId=id);r.inputSnapshotId=id;return r;};
 let calls=0,reads=0;const deps={readCredential:()=>{reads++;return 'synthetic-not-a-secret';},fetch:async(input:RequestInfo|URL,init?:RequestInit)=>{
  calls++;if(calls===1)throw Error('injected interrupted transport');
  const p=JSON.parse(await new Request(input,init).text()),messages=p.messages as{role:string;content:Parameters<typeof contentText>[0]}[],payload=JSON.parse(contentText(messages.find(m=>m.role==='user')!.content));
  const answer=payload.interview.answer.text as string,text=JSON.stringify({evidence:[{id:'e',start:0,end:4,excerpt:answer.slice(0,4)}],
   criterionScores:payload.rubric.criteria.map((c:{id:string;maxScore:number})=>({criterionId:c.id,score:c.maxScore/2,evidenceIds:['e']})),feedback:{strengths:['合成边界'],improvements:['需人工复核']}});
  return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:'stop'}]})+'\n\n'+
   'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 }};
 let first:ReturnType<typeof createDurableLiveRunManager>|undefined,second:ReturnType<typeof createDurableLiveRunManager>|undefined;
 try{
  const request=make(`durable-demo-failed-${roleId}`);first=createDurableLiveRunManager(c,deps,{path,ownerId:'first'});first.start(request);await first.wait(request.context.runId);
  const old=first.snapshot(request.context.runId),beforeReads=reads,beforeCalls=calls;first.close();
  second=createDurableLiveRunManager(c,deps,{path,ownerId:'second'});const replay=second.start(request),s=second.modelAccounting()[0]!;
  const readsDuringReload=reads-beforeReads,callsDuringReload=calls-beforeCalls;
  const command={runId:request.context.runId,attemptId:request.context.attemptId,identity:{userId:request.context.userId,roleId},callId:s.entries[0]!.callId,
   expectedVersion:s.version,usage:{inputTokens:100,outputTokens:30,complete:true},evidenceRef:'synthetic-offline-usage'};
  const reconciled=second.reconcile(command),receiptReplay=second.reconcile(command);const next=make(`durable-demo-next-${roleId}`);second.start(next);await second.wait(next.context.runId);
  const events=[];for await(const event of second.events(request.context.runId))events.push(event.type);
  return{scope:'sqlite-reopen-injected-http' as const,roleId,exactResultReplay:digest(replay)===digest(old),readsDuringReload,callsDuringReload,
   unknownRecovered:s.entries[0]!.status==='unknown',reconciled:reconciled.kind==='reconciled',exactReconciliationReplay:receiptReplay.kind==='replayed',
   nextTaskStatus:second.snapshot(next.context.runId).status,persistedEvents:events.length,httpAttempts:calls,
   liveModelCalls:0 as const,formalCommitted:false as const,vendorBillingVerified:false as const,subprocessCrashInDemo:false as const,
   retained:options.retain??false,path};
 }finally{first?.close();second?.close();if(!options.retain){for(const n of readdirSync(dir))unlinkSync(join(dir,n));rmdirSync(dir);}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){for(const role of ['java-backend','web-frontend']as const)console.log(JSON.stringify(await runDurableRuntimeDemo(role,{retain:true})));}
