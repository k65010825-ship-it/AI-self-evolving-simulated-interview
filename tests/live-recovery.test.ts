import{test,expect,spyOn}from'bun:test';
import{createLiveRunManager}from'../apps/agent/src/runtime/live-runtime.ts';
import config from'../apps/agent/src/model-access/bailian.example.json'with{type:'json'};
import{runtimeRequest}from'./helpers/runtime-request.ts';
import{fixtureAssessment}from'../experiments/pi-sdk/evaluation-fixture.ts';
const enabled=(recovery:Record<string,unknown>={httpMaxAttempts:3,maxModelRepairs:1,baseDelayMs:1,maxDelayMs:5})=>({...config,recovery,authorization:{...config.authorization,enabled:true,operatorApproved:true,expiresAt:Date.now()+60000}});
export function recoveredResponse(text=JSON.stringify(fixtureAssessment)){
 return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:'stop'}]})+'\n\n'+
  'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
test('429 then success uses two charged HTTP reservations, preserves rejected holds and reports bounded recovery',async()=>{
 let calls=0;const bodies:string[]=[];const r=createLiveRunManager(enabled(),{readCredential:()=> 'synthetic-private',fetch:async(input,init)=>{
  bodies.push(await new Request(input,init).text());return ++calls===1?new Response('private-upstream',{status:429,headers:{'retry-after':'0'}}):recoveredResponse();}});
 try{const req=runtimeRequest('retry-429');r.start(req);await r.wait(req.context.runId);expect(r.snapshot(req.context.runId).status).toBe('completed');expect(calls).toBe(2);
  const s=r.modelAccounting()[0]!;expect(s.entries.map(e=>e.status)).toEqual(['rejected','settled']);expect(s.totals.heldTokens).toBe(13500);expect(s.totals.usedTokens).toBe(130);expect(s.totals.activeSlots).toBe(0);
  expect(bodies[1]).toBe(bodies[0]);
  const d=r.recoveryDiagnostics();expect(d[0]?.events.some(e=>e.outcome==='retry-scheduled'&&e.reason==='http-429')).toBe(true);expect(JSON.stringify(d)).not.toContain('private');
 }finally{r.dispose();}
});
test('nonretryable HTTP, unknown transport and excessive Retry-After do not fan out',async()=>{
 for(const kind of ['auth','network','retry-after']as const){let calls=0;
  const r=createLiveRunManager(enabled(),{readCredential:()=> 'synthetic-private',fetch:async()=>{calls++;if(kind==='network')throw Error('private-network');return new Response('private',{status:kind==='auth'?401:503,headers:{'retry-after':'60'}});}});
  try{const req=runtimeRequest('stop-'+kind);r.start(req);await r.wait(req.context.runId);expect(calls).toBe(1);expect(r.snapshot(req.context.runId).status).toBe('failed');
   expect(r.modelAccounting()[0]!.entries[0]?.status).toBe(kind==='retry-after'?'rejected':'unknown');
  }finally{r.dispose();}
 }
});
test('cancellation during retry wait and budget exhaustion prevent later network dispatch',async()=>{
 for(const kind of ['cancel','budget']as const){let calls=0,entered!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});
  const c=enabled();if(kind==='budget')c.profile={...c.profile,limits:{...c.profile.limits,maxCalls:1,maxConcurrent:1}};
  const r=createLiveRunManager(c,{readCredential:()=> 'synthetic-private',recoverySleep:async(_ms,signal)=>{entered();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));},fetch:async()=>{calls++;return new Response('',{status:429});}});
  try{const req=runtimeRequest('wait-'+kind);r.start(req);if(kind==='cancel'){await waiting;r.cancel(req.context.runId,req.context.attemptId);}await r.wait(req.context.runId);
   expect(calls).toBe(1);expect(r.snapshot(req.context.runId).status).toBe(kind==='cancel'?'cancelled':'failed');expect(r.modelAccounting()[0]!.totals.callsConsumed).toBe(1);
  }finally{r.dispose();}
 }
});
test('invalid JSON/schema regenerates once in an isolated session; both outputs retain cost and all host validation',async()=>{
 for(const bad of ['private-malformed-output','{}']){let calls=0;const bodies:unknown[]=[];
  const r=createLiveRunManager(enabled(),{readCredential:()=> 'synthetic-private',fetch:async(input,init)=>{calls++;bodies.push(JSON.parse(await new Request(input,init).text()));return recoveredResponse(calls===1?bad:JSON.stringify(fixtureAssessment));}});
  try{const req=runtimeRequest('repair-'+bad.length);r.start(req);await r.wait(req.context.runId);expect(r.snapshot(req.context.runId).status).toBe('completed');expect(calls).toBe(2);
   expect(r.modelAccounting()[0]!.totals.usedTokens).toBe(260);expect(JSON.stringify(bodies[1])).not.toContain('private-malformed-output');
   expect(r.recoveryDiagnostics()[0]?.events.some(e=>e.outcome==='repair-scheduled')).toBe(true);
  }finally{r.dispose();}
 }
});
test('semantic evidence errors and repairs that remain invalid fail without extra attempts or invented success',async()=>{
 for(const kind of ['evidence','score','schema','budget']as const){let calls=0;const c=enabled();if(kind==='budget')c.profile={...c.profile,limits:{...c.profile.limits,maxCalls:1,maxConcurrent:1}};
  const r=createLiveRunManager(c,{readCredential:()=> 'synthetic-private',fetch:async()=>{calls++;return recoveredResponse(kind==='evidence'?JSON.stringify({...fixtureAssessment,evidence:[{id:'e1',start:0,end:4,excerpt:'伪造引用'}]}):kind==='score'?JSON.stringify({...fixtureAssessment,criterionScores:[{criterionId:'correctness',score:99,evidenceIds:['e1']}]}):'{}');}});
  try{const req=runtimeRequest('no-invent-'+kind);r.start(req);await r.wait(req.context.runId);expect(r.snapshot(req.context.runId).status).toBe('failed');expect(calls).toBe(kind==='schema'?2:1);
   expect(r.snapshot(req.context.runId).result).toBeNull();
  }finally{r.dispose();}
 }
});
test('HTTP retry followed by model regeneration shares the original run ledger and does not reset budgets',async()=>{
 let calls=0;const r=createLiveRunManager(enabled(),{readCredential:()=> 'synthetic-private',fetch:async()=>{
  calls++;return calls===1?new Response('',{status:503}):recoveredResponse(calls===2?'not-json':JSON.stringify(fixtureAssessment));}});
 try{const req=runtimeRequest('combined-recovery');r.start(req);await r.wait(req.context.runId);expect(r.snapshot(req.context.runId).status).toBe('completed');expect(calls).toBe(3);
  expect(r.modelAccounting()).toHaveLength(1);expect(r.modelAccounting()[0]?.entries.map(e=>e.status)).toEqual(['rejected','settled','settled']);
  const d=r.recoveryDiagnostics();d[0]!.events.length=0;expect(r.recoveryDiagnostics()[0]!.events.length).toBeGreaterThan(0);
 }finally{r.dispose();}
});
test('repeated service rejection stops at three attempts and a revoked host permission cannot dispatch after waiting',async()=>{
 for(const revoke of [false,true]){let calls=0,allowed=true;const r=createLiveRunManager(enabled(),{readCredential:()=> 'synthetic-private',canDispatch:()=>allowed,
  recoverySleep:async()=>{if(revoke)allowed=false;},fetch:async()=>{calls++;return new Response('',{status:503});}});
  try{const req=runtimeRequest('limit-'+revoke);r.start(req);await r.wait(req.context.runId);expect(r.snapshot(req.context.runId).status).toBe('failed');expect(calls).toBe(revoke?1:3);
   expect(r.modelAccounting()[0]!.entries.every(e=>e.status==='rejected')).toBe(true);expect(r.modelAccounting()[0]!.totals.activeSlots).toBe(0);
  }finally{r.dispose();}
 }
});
test('cancelling in model regeneration keeps its unknown consumption alongside the charged invalid first output',async()=>{
 let calls=0,entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
 const r=createLiveRunManager(enabled(),{readCredential:()=> 'synthetic-private',fetch:async()=>{calls++;if(calls===1)return recoveredResponse('{}');entered();return new Promise<Response>(()=>{});}});
 try{const req=runtimeRequest('repair-cancel-http');r.start(req);await started;r.cancel(req.context.runId,req.context.attemptId);await r.wait(req.context.runId);
  expect(r.snapshot(req.context.runId).status).toBe('cancelled');expect(calls).toBe(2);expect(r.modelAccounting()[0]!.entries.map(e=>e.status)).toEqual(['settled','unknown']);
  expect(r.modelAccounting()[0]!.totals.usedTokens).toBe(130);expect(r.modelAccounting()[0]!.totals.heldTokens).toBe(13500);
 }finally{r.dispose();}
});
test('retry wait does not start when it cannot fit the original provider timeout',async()=>{
 const base=Date.now();let tick=0;const wall=spyOn(Date,'now').mockImplementation(()=>base+2*tick++);
 const req=runtimeRequest('provider-wait-deadline');let now=req.job.input.state.startedAt,calls=0,sleeps=0;
 const c=enabled({httpMaxAttempts:3,maxModelRepairs:0,baseDelayMs:20,maxDelayMs:20});c.profile={...c.profile,limits:{...c.profile.limits,timeoutMs:1000}};
 const r=createLiveRunManager(c,{now:()=>now,readCredential:()=> 'synthetic-private',random:()=>1,recoverySleep:async()=>{sleeps++;},
  fetch:async()=>{calls++;now+=999;return new Response('',{status:429});}});
 try{r.start(req);await r.wait(req.context.runId);expect(r.snapshot(req.context.runId).status).toBe('failed');expect(calls).toBe(1);expect(sleeps).toBe(0);}
 finally{r.dispose();wall.mockRestore();}
});
