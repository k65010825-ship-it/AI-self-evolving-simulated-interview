import{test,expect}from'bun:test';
import{createLiveRunManager}from'../apps/agent/src/runtime/live-runtime.ts';
import{createBailianPiRuntime}from'../apps/agent/src/model-access/bailian-provider.ts';
import{createModelBudgetGate}from'../apps/agent/src/model-access/budget.ts';
import{LiveServiceConfigSchema}from'../packages/contracts/src/live-model.ts';
import config from'../apps/agent/src/model-access/bailian.example.json'with{type:'json'};
import{runtimeRequest}from'./helpers/runtime-request.ts';
import{fixtureAssessment}from'../experiments/pi-sdk/evaluation-fixture.ts';
function response(text:string,finish='stop'){
 return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:finish}]})+'\n\n'+
 'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
const enabled=(recovery:unknown)=>LiveServiceConfigSchema.parse({...config,recovery,authorization:{...config.authorization,enabled:true,operatorApproved:true,expiresAt:Date.now()+60000}});
for(const mode of ['regenerate','continue']as const)test(`length recovery ${mode} upgrades within the hard cap and validates a single full assessment`,async()=>{
 let calls=0;const text=JSON.stringify(fixtureAssessment),caps:number[]=[];
 const r=createLiveRunManager(enabled({initialOutputTokens:512,maxOutputRecoveries:1,truncationMode:mode}),{readCredential:()=> 'synthetic-private',fetch:async(input,init)=>{
  caps.push(JSON.parse(await new Request(input,init).text()).max_tokens);calls++;
  return calls===1?response(text.slice(0,50),'length'):response(mode==='continue'?text.slice(50):text);
 }});
 try{const req=runtimeRequest('length-'+mode);r.start(req);await r.wait(req.context.runId);expect(r.snapshot(req.context.runId).status).toBe('completed');expect(calls).toBe(2);
  expect(caps).toEqual([512,1500]);expect(r.modelAccounting()[0]!.entries.map(e=>e.status)).toEqual(['settled','settled']);expect(r.modelAccounting()[0]!.totals.usedTokens).toBe(260);
 }finally{r.dispose();}
});
test('recognized context overflow triggers one reactive compact without changing mandatory planning fields',async()=>{
 const c=enabled({maxContextCompactions:1}),now=Date.now(),gate=createModelBudgetGate(c.profile,{budgetId:'ctx',userId:'u',roleId:'java-backend',runId:'r',attemptId:'a',deadlineAt:now+30000},{allowLive:true});
 const bodies:Record<string,unknown>[]=[];let calls=0,compactorCalls=0;
 const backend=await createBailianPiRuntime(c,gate,{wireCompactors:[{id:'host-clear-memory',compactMemory:()=>{compactorCalls++;return [];}}],readCredential:()=> 'synthetic-private',fetch:async(input,init)=>{
  bodies.push(JSON.parse(await new Request(input,init).text()));return ++calls===1?Response.json({error:{code:'context_length_exceeded'}},{status:400}):response('{"questionId":null}');
 }});
 const payload={roleId:'java-backend',goal:'g',plan:{action:'probe',skillId:'java'},skills:[{skillId:'java'}],policy:{maxTurns:2},memory:[{text:'historical'}]};
 const result=await backend.runtime.completeSimple(backend.model,{messages:[{role:'user',content:JSON.stringify(payload),timestamp:now}]});
 expect(result.stopReason).toBe('stop');expect(calls).toBe(2);expect(compactorCalls).toBe(1);
 const first=bodies[0]!.messages as{role:string;content:string}[],second=bodies[1]!.messages as{role:string;content:string}[];
 const original=JSON.parse(first.find(m=>m.role==='user')!.content),compacted=JSON.parse(second.find(m=>m.role==='user')!.content);
 expect(compacted).toEqual({...original,memory:[]});expect(gate.snapshot().entries.map(e=>e.status)).toEqual(['rejected','settled']);expect(gate.snapshot().totals.heldTokens).toBeGreaterThan(0);
});
test('output upgrade rechecks context window and empty truncation cannot enable tool continuation',async()=>{
 for(const mode of ['window','empty']as const){let calls=0;
  const c=enabled({initialOutputTokens:100,maxOutputRecoveries:1,truncationMode:mode==='empty'?'continue':'regenerate',autoCompact:{enabled:true,windowTokens:mode==='window'?1000:5000,triggerRatio:.8}});
  const gate=createModelBudgetGate(c.profile,{budgetId:mode,userId:'u',roleId:'java-backend',runId:'r',attemptId:'a',deadlineAt:Date.now()+30000},{allowLive:true});
  const b=await createBailianPiRuntime(c,gate,{readCredential:()=> 'synthetic-private',fetch:async()=>++calls===1?response(mode==='empty'?'':'x','length'):response('{}')});
  const result=await b.runtime.completeSimple(b.model,{messages:[{role:'user',content:'hi',timestamp:Date.now()}]});
  expect(result.stopReason).toBe('error');expect(calls).toBe(1);expect(gate.snapshot().entries[0]?.status).toBe('settled');
 }
});
test('nonempty continuation never forwards tool calls and appended prefix is included in window checking',async()=>{
 for(const mode of ['tool','window']as const){let calls=0;const c=enabled({initialOutputTokens:100,maxOutputRecoveries:1,truncationMode:'continue',autoCompact:{enabled:true,windowTokens:mode==='window'?1800:10000,triggerRatio:.8}});
  const gate=createModelBudgetGate(c.profile,{budgetId:mode,userId:'u',roleId:'java-backend',runId:'r',attemptId:'a',deadlineAt:Date.now()+30000},{allowLive:true});
  const b=await createBailianPiRuntime(c,gate,{readCredential:()=> 'synthetic-private',fetch:async()=>{
   if(++calls===1)return response('x'.repeat(500),'length');
   return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,id:'bad',type:'function',function:{name:'query_role_knowledge',arguments:'{}'}}]},finish_reason:'tool_calls'}]})+'\n\n'+
    'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  }});
  const r=await b.runtime.completeSimple(b.model,{messages:[{role:'user',content:'hi',timestamp:Date.now()}]});expect(r.stopReason).toBe('error');expect(r.content).toEqual([]);expect(calls).toBe(mode==='window'?1:2);
 }
});
