import {test,expect} from 'bun:test';
import {LiveServiceConfigSchema} from '../packages/contracts/src/live-model.ts';
import {createLiveRunManager} from '../apps/agent/src/runtime/live-runtime.ts';
import config from '../apps/agent/src/model-access/qianwen.example.json' with {type:'json'};
import {runtimeRequest} from './helpers/runtime-request.ts';
const enabled=()=>({...structuredClone(config),evaluationResponseFormat:'json_object',authorization:{...config.authorization,enabled:true,operatorApproved:true,expiresAt:Date.now()+60000}});
function stream(text:string,finish='stop'){return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:finish}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
test('legacy config has no injected field and JSON fragment continuation fails before credentials',()=>{
 expect(LiveServiceConfigSchema.parse(config)).not.toHaveProperty('evaluationResponseFormat');
 expect(()=>createLiveRunManager({...enabled(),recovery:{maxOutputRecoveries:1,truncationMode:'continue'}},{readCredential:()=>{throw Error('must not read');}})).toThrow('LIVE_MODEL_CONFIG_INVALID');
 expect(LiveServiceConfigSchema.safeParse({...enabled(),recovery:{maxOutputRecoveries:1,truncationMode:'regenerate'}}).success).toBe(true);
});
test('requested JSON mode cannot bypass syntax, schema or truncation checks; usage still settles',async()=>{
 for(const [text,finish] of [['{"x":','stop'],['{"privateExtra":true}','stop'],['{}','length']]as const){
  let calls=0;const runtime=createLiveRunManager(enabled(),{readCredential:()=> 'synthetic',fetch:async(input,init)=>{
   calls++;const body=JSON.parse(await new Request(input,init).text());expect(body.response_format).toEqual({type:'json_object'});expect(body.enable_thinking).toBe(false);expect(body.max_tokens).toBe(config.profile.limits.maxOutputTokens);return stream(text,finish);
  }});try{const r=runtimeRequest('json-mode-'+finish+text.length);runtime.start(r);await runtime.wait(r.context.runId);expect(runtime.snapshot(r.context.runId).status).toBe('failed');expect(calls).toBe(1);expect(runtime.modelAccounting()[0]!.entries[0]!.status).toBe('settled');
  }finally{runtime.dispose();}
 }
});
test('HTTP 400 in JSON mode holds conservative rejected cost, emits fixed facts, never falls back',async()=>{
 let calls=0;const runtime=createLiveRunManager(enabled(),{readCredential:()=> 'synthetic',fetch:async()=>{calls++;return new Response('private upstream text',{status:400});}});
 try{const r=runtimeRequest('json-http400');runtime.start(r);await runtime.wait(r.context.runId);expect(runtime.snapshot(r.context.runId).status).toBe('failed');expect(calls).toBe(1);
  const s=runtime.modelAccounting()[0]!;expect(s.entries[0]!.status).toBe('rejected');expect(s.totals.heldCostMicros).toBeGreaterThan(0);
  const events=runtime.evaluationDiagnostics()[0]!.events;expect(events.some(e=>e.reason==='json-mode-http-rejected')).toBe(true);expect(JSON.stringify(events)).not.toContain('private');
 }finally{runtime.dispose();}
});
