import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {removeAccountingTemp} from './helpers/accounting-temp.ts';
import {pathToFileURL} from 'node:url';
import {Database} from 'bun:sqlite';
import {createPilotAgentRuntime} from '../apps/agent/src/runtime/pilot-runtime.ts';
import {openSessionAccounting} from '../apps/agent/src/accounting/session-ledger.ts';
import {createInterviewWorkflow,planInterviewQuestion} from '../apps/agent/src/orchestration/session-workflow.ts';
import {createWorkflowFixture} from '../experiments/session/fixture.ts';
import config from '../apps/agent/src/model-access/bailian.example.json' with {type:'json'};
async function fixture(){const at=Date.now(),identity={userId:'real-student',roleId:'java-backend' as const};
 const initial=createInterviewWorkflow({identity,session:{sessionId:'shared-session',roleId:identity.roleId,durationMinutes:20,skills:[{skillId:'project-design',relevance:1}]},
 policy:{id:'p',roleId:identity.roleId,parameters:{maxFollowupDepth:0,maxTurns:2,wrapUpSeconds:30}},goal:'offline transport verification',skillLabels:{'project-design':'design'},allowDraftKnowledge:true,now:at});
 const local=await createWorkflowFixture(),context={...identity,runId:'local-plan',attemptId:'attempt',deadlineAt:at+60000};
 const planned=await planInterviewQuestion(initial,{identity,expectedRevision:0,context},{...local,now:()=>at});
 const request=(runId:string)=>{const c={...context,runId};return {inputSnapshotId:`input-${runId}`,context:c,job:{type:'workflow' as const,operation:{action:'answer' as const,snapshot:planned,command:{identity,expectedRevision:planned.revision,context:c,observationId:`obs-${runId}`,answer:{id:`answer-${runId}`,text:'具体业务方案'},quality:1,evidenceMode:'live-model' as const}}}};};
 const dir=mkdtempSync(join(tmpdir(),'pilot-runtime-')),ledger=openSessionAccounting(join(dir,'ledger.sqlite'));
 ledger.ensureSession({sessionId:'shared-session',...identity,currency:'CNY',maxCostMicros:100000,maxCalls:1,maxConcurrent:1,deadlineAt:at+60000});
 const enabled={...config,authorization:{...config.authorization,enabled:true,operatorApproved:true,maxRuns:4,expiresAt:at+60000}};
 let reads=0,calls=0;const deps={path:join(dir,'runs.sqlite'),bindingsPath:join(dir,'bindings.sqlite'),ledger,liveConfig:enabled,
 readCredential:()=>{reads++;return 'synthetic-project-secret';},fetch:async(_input:RequestInfo|URL,init?:RequestInit)=>{calls++;const input=_input instanceof Request?_input:new Request(_input,init),body=await input.json() as any;
 const message=body.messages.filter((m:any)=>m.role==='user').at(-1).content;
 const user=JSON.parse(typeof message==='string'?message:message.map((p:any)=>p.text??'').join('')),text=user.interview.answer.text;
 const content=JSON.stringify({evidence:[{id:'e',start:0,end:4,excerpt:text.slice(0,4)}],criterionScores:user.rubric.criteria.map((c:any)=>({criterionId:c.id,score:c.maxScore/2,evidenceIds:['e']})),feedback:{strengths:[],improvements:['synthetic fixture']}});
 return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}};
 return{dir,ledger,deps,request,stats:()=>({reads,calls})};
}
test('pilot runtime atomically shares one real session budget across two workflow runs',async()=>{
 const f=await fixture(),runtime=createPilotAgentRuntime(f.deps);try{expect(f.stats()).toEqual({reads:0,calls:0});
 const first=f.request('first');runtime.start(first);await runtime.wait('first');expect({snapshot:runtime.snapshot('first'),stats:f.stats(),ledger:f.ledger.snapshot('shared-session')}).toMatchObject({snapshot:{status:'completed'}});
 runtime.start(f.request('second'));await runtime.wait('second');expect(runtime.snapshot('second').status).toBe('failed');
 expect(f.stats()).toEqual({reads:1,calls:1});expect(f.ledger.snapshot('shared-session').totals.callsConsumed).toBe(1);
 expect(f.ledger.snapshot('shared-session').entries[0]?.userId).toBe('real-student');
 }finally{runtime.close();f.ledger.close();removeAccountingTemp(f.dir);}
});
test('SQLite reopen replays exact result without credentials and rejects changed binding/request',async()=>{
 const f=await fixture(),a=createPilotAgentRuntime(f.deps);let b:ReturnType<typeof createPilotAgentRuntime>|undefined;
 try{const req=f.request('persisted');a.start(req);await a.wait('persisted');const old=a.snapshot('persisted');expect(old.status).toBe('completed');a.close();
 b=createPilotAgentRuntime({...f.deps,liveConfig:config,readCredential:()=>{throw Error('must not read');},fetch:async()=>{throw Error('must not fetch');}});
 expect(b.start(req)).toEqual(old);expect(f.stats().calls).toBe(1);
 expect(()=>b!.start({...req,inputSnapshotId:'different'})).toThrow('VERSION_CONFLICT');
 const other=structuredClone(req);other.context.userId='other';other.job.operation.command.identity.userId='other';other.job.operation.command.context.userId='other';
 expect(()=>b!.start(other)).toThrow();
 expect(readFileSync(f.deps.bindingsPath).includes(Buffer.from('synthetic-project-secret'))).toBe(false);
 }finally{a.close();b?.close();f.ledger.close();removeAccountingTemp(f.dir);}
});
test('missing or mismatched API-owned scope fails before any credentials or HTTP',async()=>{
 const f=await fixture(),runtime=createPilotAgentRuntime(f.deps);try{const missing=f.request('missing');missing.job.operation.snapshot.state.sessionId='unknown-session';
 expect(()=>runtime.start(missing)).toThrow();const wrong=f.request('wrong');wrong.context.userId='other';wrong.job.operation.command.context.userId='other';
 expect(()=>runtime.start(wrong)).toThrow();expect(f.stats()).toEqual({reads:0,calls:0});
 }finally{runtime.close();f.ledger.close();removeAccountingTemp(f.dir);}
});
for(const terminal of ['running','cancelled','failed'] as const)test(`process death after dispatch recovers ${terminal} budget without rewriting terminal state or replay`,async()=>{
 const f=await fixture(),req=f.request('crash-run'),moduleUrl=pathToFileURL(join(process.cwd(),'apps/agent/src/runtime/pilot-runtime.ts')).href,
 ledgerUrl=pathToFileURL(join(process.cwd(),'apps/agent/src/accounting/session-ledger.ts')).href;
 const code=`import {createPilotAgentRuntime} from ${JSON.stringify(moduleUrl)};import {openSessionAccounting} from ${JSON.stringify(ledgerUrl)};
 const ledger=openSessionAccounting(${JSON.stringify(f.ledger.path)});const r=createPilotAgentRuntime({path:${JSON.stringify(f.deps.path)},bindingsPath:${JSON.stringify(f.deps.bindingsPath)},ledger,liveConfig:${JSON.stringify(f.deps.liveConfig)},readCredential:()=> 'synthetic-crash-only',fetch:async()=>{console.log('dispatched');return new Promise(()=>{});}});r.start(${JSON.stringify(req)});setInterval(()=>{},1000);`;
 const child=Bun.spawn([process.execPath,'-e',code],{stdout:'pipe',stderr:'pipe'});let reopened:ReturnType<typeof createPilotAgentRuntime>|undefined;
 try{const reader=child.stdout.getReader(),data=await reader.read();expect(new TextDecoder().decode(data.value)).toContain('dispatched');child.kill();await child.exited;reader.releaseLock();
  expect(f.ledger.snapshot('shared-session').entries[0]?.status).toBe('dispatched');
  // Seed the persisted terminal checkpoint left when the budget callback fails during cancellation.
  // The real child dispatch/crash above is unchanged; this fixture models a partial terminal write.
  if(terminal!=='running'){const store=new Database(f.deps.path);try{const row=store.query('SELECT snapshot FROM agent_tasks WHERE run_id=?').get('crash-run') as {snapshot:string};
   const snapshot=JSON.parse(row.snapshot);snapshot.status=terminal;snapshot.stage=null;
   snapshot.error={code:terminal==='cancelled'?'RUN_CANCELLED':'DEPENDENCY_UNAVAILABLE',message:'Synthetic terminal checkpoint',retryable:false};
   store.query('UPDATE agent_tasks SET status=?,snapshot=? WHERE run_id=?').run(terminal,JSON.stringify(snapshot),'crash-run');
  }finally{store.close();}}
  reopened=createPilotAgentRuntime({...f.deps,now:()=>req.context.deadlineAt-20000,readCredential:()=>{throw Error('must not read');},fetch:async()=>{throw Error('must not replay');}});
  expect(reopened.durableTasks('crash-run')?.status).toBe(terminal==='running'?'interrupted':terminal);expect(f.ledger.snapshot('shared-session').entries[0]?.status).toBe('unknown');
  expect(reopened.start(req).status).toBe(terminal==='running'?'failed':terminal);expect(f.stats()).toEqual({reads:0,calls:0});
 }finally{child.kill();await child.exited;reopened?.close();f.ledger.close();removeAccountingTemp(f.dir);}
});
