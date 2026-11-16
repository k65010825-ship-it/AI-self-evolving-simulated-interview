import { test,expect } from 'bun:test';
import { createLiveRunManager } from '../apps/agent/src/runtime/live-runtime.ts';
import config from '../apps/agent/src/model-access/bailian.example.json' with {type:'json'};
import { runtimeRequest } from './helpers/runtime-request.ts';
import {contentText}from'../experiments/pi-sdk/planner-fixture.ts';

const enabled=()=>({...config,authorization:{...config.authorization,enabled:true,operatorApproved:true,expiresAt:Date.now()+60000}});
test('dispatch rechecks process blocking after asynchronous request body inspection',async()=>{
 let allowed=true,checks=0,calls=0;
 const runtime=createLiveRunManager(enabled(),{readCredential:()=> 'synthetic-not-a-secret',
  canDispatch:()=>{checks++;if(checks===2)queueMicrotask(()=>{allowed=false;});return allowed;},
  fetch:async()=>{calls++;return response();}});
 try{const r=runtimeRequest('live-dispatch-race');runtime.start(r);await runtime.wait(r.context.runId);
  expect(checks).toBeGreaterThanOrEqual(3);expect(calls).toBe(0);
  expect(runtime.snapshot(r.context.runId).status).toBe('failed');expect(runtime.modelAccounting()[0]!.entries).toEqual([]);
 }finally{runtime.dispose();}
});
function response(usage=true,status=200,counts={input:100,output:30},completion?:string){
 const text=completion??JSON.stringify({evidence:[{id:'e',start:0,end:4,excerpt:'事务边界'}],criterionScores:[{criterionId:'correctness',score:2,evidenceIds:['e']}],feedback:{strengths:['边界'],improvements:['验证']}});
 const chunk=(delta:unknown,finish_reason:string|null)=>({id:'mock',object:'chat.completion.chunk',created:0,model:config.profile.modelId,choices:[{index:0,delta,finish_reason}]});
 const data=[chunk({role:'assistant',content:text},null),chunk({},'stop'),...(usage?[{id:'mock',choices:[],usage:{prompt_tokens:counts.input,completion_tokens:counts.output,total_tokens:counts.input+counts.output}}]:[])];
 return new Response(data.map(d=>'data: '+JSON.stringify(d)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n',{status,headers:{'content-type':'text/event-stream'}});
}
test('disabled or expired service fails before resolving credentials or dispatching HTTP',()=>{
 let secrets=0,network=0;const deps={readCredential:()=>{secrets++;return 'synthetic-not-a-secret';},fetch:async()=>{network++;return response();}};
 expect(()=>createLiveRunManager(config,deps)).toThrow('LIVE_SERVICE_NOT_AUTHORIZED');
 expect(()=>createLiveRunManager({...enabled(),authorization:{...enabled().authorization,expiresAt:1}},deps)).toThrow('LIVE_SERVICE_NOT_AUTHORIZED');
 expect(secrets).toBe(0);expect(network).toBe(0);
});
test('invalid endpoint or missing credential cannot dispatch, while bad model JSON with complete usage is still charged',async()=>{
 let calls=0;const deps={readCredential:()=>undefined,fetch:async()=>{calls++;return response();}};
 expect(()=>createLiveRunManager({...enabled(),profile:{...config.profile,endpoint:'https://example.com/compatible-mode/v1'}},deps)).toThrow('LIVE_MODEL_CONFIG_INVALID');
 const missing=createLiveRunManager(enabled(),deps);
 try{const r=runtimeRequest('live-no-key');missing.start(r);await missing.wait(r.context.runId);expect(calls).toBe(0);expect(missing.modelAccounting()[0]!.entries).toEqual([]);}finally{missing.dispose();}
 const bad=createLiveRunManager(enabled(),{readCredential:()=> 'synthetic-not-a-secret',fetch:async()=>response(true,200,{input:100,output:30},'not-json')});
 try{
  const r=runtimeRequest('live-invalid-json');bad.start(r);await bad.wait(r.context.runId);
  expect(bad.snapshot(r.context.runId).error?.code).toBe('MODEL_OUTPUT_INVALID');expect(bad.modelAccounting()[0]!.totals.usedTokens).toBe(130);
 }finally{bad.dispose();}
});
test('live Pi planning uses the real knowledge tool and shares one ledger across three HTTP attempts',async()=>{
 let calls=0;const c={...enabled(),planning:'pi-knowledge'};
 const runtime=createLiveRunManager(c,{readCredential:()=> 'synthetic-not-a-secret',fetch:async(input,init)=>{
  calls++;const r=new Request(input,init),body=JSON.parse(await r.text()),messages=body.messages as {role:string;content:string|{type:string;text?:string}[]}[];
  const tool=messages.filter(m=>m.role==='tool').at(-1);
  if(tool){const receipt=JSON.parse(contentText(tool.content));return response(true,200,{input:100,output:30},JSON.stringify({questionId:receipt.data.items[0]?.id??null}));}
  const payload=JSON.parse(contentText(messages.find(m=>m.role==='user')!.content));
  if(payload.rubric)return response();
  const delta={role:'assistant',tool_calls:[{index:0,id:'knowledge-call',type:'function',function:{name:'query_role_knowledge',arguments:JSON.stringify({skillId:payload.plan.skillId,limit:3})}}]};
  return new Response('data: '+JSON.stringify({id:'mock',choices:[{index:0,delta,finish_reason:null}]})+'\n\n'+
   'data: '+JSON.stringify({id:'mock',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]})+'\n\n'+
   'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 }});
 try{
  const r=runtimeRequest('live-tools');runtime.start(r);await runtime.wait(r.context.runId);const result=runtime.snapshot(r.context.runId);
  expect(result.status).toBe('completed');expect(calls).toBe(3);expect(runtime.modelAccounting()[0]!.totals.usedTokens).toBe(390);
  if(result.result?.kind!=='uncommitted-turn-result')throw Error('expected proposal');
  expect(result.result.planning?.receipts[0]?.toolName).toBe('query_role_knowledge');expect(result.result.selection.status).toBe('selected');
 }finally{runtime.dispose();}
},15000);
test('overrun records full usage and blocks further service runs instead of hiding it in a fresh ledger',async()=>{
 let calls=0;const runtime=createLiveRunManager(enabled(),{readCredential:()=> 'synthetic-not-a-secret',fetch:async()=>{calls++;return response(true,200,{input:config.profile.limits.maxInputTokens+1,output:30});}});
 try{
  const first=runtimeRequest('live-overrun');runtime.start(first);await runtime.wait(first.context.runId);
  const ledger=runtime.modelAccounting()[0]!;expect(ledger.locked).toBe(true);expect(ledger.entries[0]!.status).toBe('settled');
  expect(ledger.entries[0]!.usage!.inputTokens).toBe(config.profile.limits.maxInputTokens+1);
  const next=runtimeRequest('live-after-overrun');runtime.start(next);await runtime.wait(next.context.runId);
  expect(runtime.snapshot(next.context.runId).status).toBe('failed');expect(calls).toBe(1);
 }finally{runtime.dispose();}
});
test('cancelled HTTP attempt retains unknown usage and never releases it as a free call',async()=>{
 let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
 const runtime=createLiveRunManager(enabled(),{readCredential:()=> 'synthetic-not-a-secret',fetch:async()=>{entered();return new Promise<Response>(()=>{});}});
 try{
  const request=runtimeRequest('live-cancel');runtime.start(request);await started;runtime.cancel(request.context.runId,request.context.attemptId);await runtime.wait(request.context.runId);
  expect(runtime.snapshot(request.context.runId).status).toBe('cancelled');
  expect(runtime.modelAccounting()[0]!.entries[0]!.status).toBe('unknown');expect(runtime.modelAccounting()[0]!.totals.heldTokens).toBeGreaterThan(0);
 }finally{runtime.dispose();}
},10000);
test('real Pi evaluation goes through pinned HTTP boundary, charges raw complete usage and disables reasoning/retries',async()=>{
 let calls=0;const bodies:Record<string,unknown>[]=[];
 const runtime=createLiveRunManager(enabled(),{readCredential:name=>{expect(name).toBe('INTERVIEW_BAILIAN_API_KEY');return 'synthetic-not-a-secret';},fetch:async(input,init)=>{
  calls++;const r=new Request(input,init);expect(r.url).toBe(config.profile.endpoint+'/chat/completions');expect(r.redirect).toBe('error');
  expect(r.headers.get('authorization')).toBe('Bearer synthetic-not-a-secret');bodies.push(JSON.parse(await r.text()));return response();
 }});
 try{
  const request=runtimeRequest('live-mock');runtime.start(request);await runtime.wait(request.context.runId);
  expect(runtime.snapshot(request.context.runId).status).toBe('completed');expect(calls).toBe(1);
  expect(bodies[0]!.enable_thinking).toBe(false);expect(bodies[0]!.max_tokens).toBe(config.profile.limits.maxOutputTokens);
  const ledger=runtime.modelAccounting()[0]!;expect(ledger.totals.usedTokens).toBe(130);expect(ledger.entries[0]!.status).toBe('settled');expect(ledger.currency).toBe('CNY');
  expect(JSON.stringify(ledger)).not.toContain('synthetic-not-a-secret');
 }finally{runtime.dispose();}
},15000);
test('missing usage and HTTP failure keep unknown holds and never automatically retry',async()=>{
 for(const variant of ['missing','http']as const){let calls=0;
  const runtime=createLiveRunManager(enabled(),{readCredential:()=> 'synthetic-not-a-secret',fetch:async()=>{calls++;return variant==='missing'?response(false):new Response('synthetic-not-a-secret upstream details',{status:500});}});
  try{
   const request=runtimeRequest('live-'+variant);runtime.start(request);await runtime.wait(request.context.runId);
   expect(runtime.snapshot(request.context.runId).status).toBe('failed');expect(calls).toBe(1);
   const ledger=runtime.modelAccounting()[0]!;expect(ledger.entries[0]!.status).toBe('unknown');expect(ledger.totals.heldTokens).toBeGreaterThan(0);
   expect(JSON.stringify(runtime.snapshot(request.context.runId))).not.toContain('synthetic-not-a-secret');
  }finally{runtime.dispose();}
 }
},15000);
