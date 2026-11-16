import{test,expect}from'bun:test';
import{createDurableLiveRunManager}from'../apps/agent/src/runtime/durable-runtime.ts';
import config from'../apps/agent/src/model-access/bailian.example.json'with{type:'json'};
import{runtimeRequest}from'./helpers/runtime-request.ts';
import{fixtureAssessment}from'../experiments/pi-sdk/evaluation-fixture.ts';
import{mkdtempSync,readdirSync,unlinkSync,rmdirSync}from'node:fs';import{join}from'node:path';
import{runDurableRuntimeDemo}from'../scripts/demo-durable-runtime.ts';
function response(){return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(fixtureAssessment)},finish_reason:'stop'}]})+'\n\n'+
 'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
const enabled=()=>({...config,authorization:{...config.authorization,enabled:true,operatorApproved:true,expiresAt:Date.now()+60000}});
test('completed result, SSE history and budget reload from SQLite without credentials or repeated HTTP',async()=>{
 const dir=mkdtempSync(join(process.cwd(),'.cache','durable-runtime-')),path=join(dir,'agent.sqlite');let calls=0;
 const a=createDurableLiveRunManager(enabled(),{readCredential:()=> 'synthetic-private',fetch:async()=>{calls++;return response();}},{path,ownerId:'a'});
 let b:ReturnType<typeof createDurableLiveRunManager>|undefined;
 try{
  const req=runtimeRequest('durable-success');a.start(req);await a.wait(req.context.runId);expect(a.snapshot(req.context.runId).status).toBe('completed');const old=a.snapshot(req.context.runId),events=[];
  for await(const event of a.events(req.context.runId))events.push(event);a.close();
  b=createDurableLiveRunManager(config,{readCredential:()=>{throw Error('must not read credential');},fetch:async()=>{calls++;throw Error('must not call');}},{path,ownerId:'b'});
  expect(b.start(req)).toEqual(old);expect(b.snapshot(req.context.runId)).toEqual(old);expect(b.modelAccounting()[0]?.totals.usedTokens).toBe(130);
  const replay=[];for await(const event of b.events(req.context.runId,1))replay.push(event);expect(replay).toEqual(events.slice(1));expect(calls).toBe(1);
  expect(()=>b!.start({...req,inputSnapshotId:'changed'})).toThrow('VERSION_CONFLICT');
 }finally{a.close();b?.close();for(const n of readdirSync(dir))unlinkSync(join(dir,n));rmdirSync(dir);}
});
test('same manager can dispatch a new task after trusted reconciliation clears unknown consumption',async()=>{
 const dir=mkdtempSync(join(process.cwd(),'.cache','durable-reconcile-'));let calls=0;
 const r=createDurableLiveRunManager(enabled(),{readCredential:()=> 'synthetic-private',fetch:async()=>{if(++calls===1)throw Error('network');return response();}},{path:join(dir,'a.sqlite'),ownerId:'one'});
 try{const first=runtimeRequest('durable-unknown');r.start(first);await r.wait(first.context.runId);const s=r.modelAccounting()[0]!;
  expect(s.entries[0]?.status).toBe('unknown');r.reconcile({runId:first.context.runId,attemptId:first.context.attemptId,identity:{userId:first.context.userId,roleId:first.context.roleId},
   expectedVersion:s.version,callId:s.entries[0]!.callId,usage:{inputTokens:100,outputTokens:30,complete:true},evidenceRef:'synthetic-usage'});
  const next=runtimeRequest('durable-after-reconcile');r.start(next);await r.wait(next.context.runId);expect(r.snapshot(next.context.runId).status).toBe('completed');expect(calls).toBe(2);
 }finally{r.close();for(const n of readdirSync(dir))unlinkSync(join(dir,n));rmdirSync(dir);}
});
for(const role of ['java-backend','web-frontend']as const)test(`${role} durable demo reloads without credentials, reconciles and completes a new task`,async()=>{
 const d=await runDurableRuntimeDemo(role);expect(d.exactResultReplay).toBe(true);expect(d.readsDuringReload).toBe(0);expect(d.callsDuringReload).toBe(0);
 expect(d.exactReconciliationReplay).toBe(true);expect(d.nextTaskStatus).toBe('completed');expect(d.liveModelCalls).toBe(0);expect(d.formalCommitted).toBe(false);
});
test('the same authorization cannot regain maxRuns by reopening the database',async()=>{
 const dir=mkdtempSync(join(process.cwd(),'.cache','durable-quota-')),path=join(dir,'a.sqlite');let calls=0;
 const c={...enabled(),authorization:{...enabled().authorization,maxRuns:1}},deps={readCredential:()=> 'synthetic-private',fetch:async()=>{calls++;return response();}};
 const a=createDurableLiveRunManager(c,deps,{path,ownerId:'a'});let b:ReturnType<typeof createDurableLiveRunManager>|undefined;
 try{const req=runtimeRequest('quota-first');a.start(req);await a.wait(req.context.runId);a.close();b=createDurableLiveRunManager(c,deps,{path,ownerId:'b'});
  expect(b.start(req).status).toBe('completed');let code='';try{b.start(runtimeRequest('quota-second'));}catch(e){code=e instanceof Error?e.message:'';}
  if(!code)await b.wait('quota-second');expect(code).toBe('RATE_LIMITED');expect(calls).toBe(1);
 }finally{a.close();b?.close();for(const n of readdirSync(dir))unlinkSync(join(dir,n));rmdirSync(dir);}
});
