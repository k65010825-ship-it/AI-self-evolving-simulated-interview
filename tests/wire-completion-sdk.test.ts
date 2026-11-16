import {expect,test} from 'bun:test';
import {createLiveRunManager} from '../apps/agent/src/runtime/live-runtime.ts';
import config from '../apps/agent/src/model-access/bailian.example.json' with {type:'json'};
import {runtimeRequest} from './helpers/runtime-request.ts';
const output=JSON.stringify({evidence:[{id:'e',start:0,end:4,excerpt:'事务边界'}],criterionScores:[{criterionId:'correctness',score:2,evidenceIds:['e']}],feedback:{strengths:['边界'],improvements:['验证']}});
function response(text:string,finish:string|null='stop',done=true){const raw='data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:finish}]})+'\r\n\r\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\r\n\r\n'+(done?'data: [DONE]\r\n\r\n':'');
 const bytes=new TextEncoder().encode(raw);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.subarray(i,i+7));c.close();}}),{headers:{'content-type':'text/event-stream'}});}
const enabled=()=>({...structuredClone(config),authorization:{...config.authorization,enabled:true,operatorApproved:true,expiresAt:Date.now()+60000}});
test('SDK may stop at terminal CR while the server withholds LF and EOF; completed usage still settles',async()=>{
 const runtime=createLiveRunManager(enabled(),{readCredential:()=> 'synthetic',fetch:async()=>{
  const raw=(await response(output).text()).slice(0,-1);return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(raw));}}),{headers:{'content-type':'text/event-stream'}});
 }});
 try{const r=runtimeRequest('wire-cr-stop');runtime.start(r);await runtime.wait(r.context.runId);expect(runtime.snapshot(r.context.runId).status).toBe('completed');
  expect(runtime.modelAccounting()[0]!.entries[0]!.status).toBe('settled');expect(runtime.evaluationDiagnostics()[0]!.events.find(d=>d.wireCompletion)?.wireCompletion?.doneSeen).toBe(true);
 }finally{runtime.dispose();}
});
test('upstream malformed JSON survives byte fragments into SDK unchanged and is charged once, not repaired',async()=>{
 let calls=0;const runtime=createLiveRunManager(enabled(),{readCredential:()=> 'synthetic',fetch:async()=>{calls++;return response('{"private":"open');}});
 try{const r=runtimeRequest('wire-json');runtime.start(r);await runtime.wait(r.context.runId);
  expect(runtime.snapshot(r.context.runId).status).toBe('failed');const events=runtime.evaluationDiagnostics()[0]!.events;
  expect(events).toContainEqual({version:1,stage:'transport',outcome:'observed',reason:'wire-completion-observed',wireCompletion:{doneSeen:true,finish:'stop',framing:'valid',textMatch:'matched',sdkStop:'stop',comparisonScope:'upstream-to-sdk'}});
  expect(events.some(d=>d.jsonIssue==='unclosed-structure')).toBe(true);expect(calls).toBe(1);expect(runtime.modelAccounting()[0]!.entries[0]!.status).toBe('settled');expect(JSON.stringify(events)).not.toContain('private');
 }finally{runtime.dispose();}
});
test('missing finish or missing DONE fails with conservative accounting and only fixed wire facts',async()=>{
 for(const mode of ['finish','done']as const){const runtime=createLiveRunManager(enabled(),{readCredential:()=> 'synthetic',fetch:async()=>response(output,mode==='finish'?null:'stop',mode!=='done')});
  try{const r=runtimeRequest('wire-missing-'+mode);runtime.start(r);await runtime.wait(r.context.runId);expect(runtime.snapshot(r.context.runId).status).toBe('failed');
   const wire=runtime.evaluationDiagnostics()[0]!.events.find(d=>d.wireCompletion)?.wireCompletion;expect({mode,wire}).toMatchObject({wire:{doneSeen:mode!=='done',finish:mode==='finish'?'missing':'stop'}});expect(runtime.modelAccounting()[0]!.entries[0]!.status).toBe('unknown');
  }finally{runtime.dispose();}
 }
});
test('wire observers cannot change a valid result; controlled continuation is not compared with only its suffix',async()=>{
 for(const continuation of [false,true]){let calls=0;const cfg=enabled();cfg.profile.limits.maxCalls=continuation?2:1;
  const runtime=createLiveRunManager({...cfg,recovery:{httpMaxAttempts:1,maxModelRepairs:0,...(continuation?{initialOutputTokens:512,maxOutputRecoveries:1,truncationMode:'continue'}:{})}},
   {readCredential:()=> 'synthetic',onCompletion:()=>{throw Error('private observer failure');},fetch:async()=>{calls++;return continuation?(calls===1?response(output.slice(0,30),'length'):response(output.slice(30))):response(output);}});
  try{const r=runtimeRequest('wire-valid-'+continuation);runtime.start(r);await runtime.wait(r.context.runId);expect({continuation,status:runtime.snapshot(r.context.runId).status,error:runtime.snapshot(r.context.runId).error,diagnostics:runtime.evaluationDiagnostics()}).toMatchObject({status:'completed'});
   const wire=runtime.evaluationDiagnostics()[0]!.events.find(d=>d.wireCompletion)?.wireCompletion;expect(wire?.comparisonScope).toBe(continuation?'host-continuation-not-compared':'upstream-to-sdk');expect(wire?.textMatch).toBe(continuation?'unavailable':'matched');expect(calls).toBe(continuation?2:1);
  }finally{runtime.dispose();}
 }
});
