import { test, expect } from 'bun:test';
import config from '../apps/agent/src/model-access/bailian.example.json' with { type:'json' };
import { prepareBailianAcceptance,runBailianAcceptance,digest } from '../evals/live-bailian/runner.ts';
import { LiveModelProfileSchema } from '../packages/contracts/src/model-access.ts';
import { contentText } from '../experiments/pi-sdk/planner-fixture.ts';
import { parseLiveAcceptanceArgs } from '../scripts/live-bailian-acceptance.ts';
const ready=()=>({...config,planning:'pi-knowledge',authorization:{...config.authorization,enabled:true,operatorApproved:true,expiresAt:Date.now()+60000}});
function stream(delta:unknown,reason='stop') {
 return new Response('data: '+JSON.stringify({id:'mock',choices:[{index:0,delta,finish_reason:reason}]})+'\n\n'+
  'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n',
  {headers:{'content-type':'text/event-stream'}});
}
test('plan-only and disabled execute never inspect credentials or send a request',async()=>{
 let touches=0;const deps={readCredential:()=>{touches++;return 'synthetic-only';},fetch:async()=>{touches++;throw Error('not allowed');}};
 expect((await runBailianAcceptance(ready(),deps)).mode).toBe('plan-only');expect(touches).toBe(0);
 await expect(runBailianAcceptance(config,deps,{execute:true})).rejects.toThrow('ACCEPTANCE_NOT_AUTHORIZED_OR_READY');expect(touches).toBe(0);
 const inadequate={...ready(),profile:{...config.profile,limits:{...config.profile.limits,maxCostMicros:1}}};
 expect(prepareBailianAcceptance(inadequate).issues).toContain('THREE_ATTEMPT_RESERVATION_REQUIRED');
});
test('two-role smoke exercises real Pi tool loops and leaves semantic review pending',async()=>{
 let calls=0;
 const r=await runBailianAcceptance(ready(),{readCredential:()=> 'synthetic-only',fetch:async(input,init)=>{
  calls++;const body=JSON.parse(await new Request(input,init).text()),messages=body.messages as {role:string;content:Parameters<typeof contentText>[0]}[];
  const tool=messages.find(m=>m.role==='tool');
  if(tool){const receipt=JSON.parse(contentText(tool.content));return stream({role:'assistant',content:JSON.stringify({questionId:receipt.data.items[0].id})});}
  const payload=JSON.parse(contentText(messages.find(m=>m.role==='user')!.content));
  if(payload.rubric){const text=payload.interview.answer.text as string;
   return stream({role:'assistant',content:JSON.stringify({evidence:[{id:'e',start:0,end:4,excerpt:text.slice(0,4)}],
    criterionScores:payload.rubric.criteria.map((c:{id:string;maxScore:number})=>({criterionId:c.id,score:c.maxScore/2,evidenceIds:['e']})),
    feedback:{strengths:['合成反馈'],improvements:['人工复核']}})});
  }
  return stream({role:'assistant',tool_calls:[{index:0,id:'knowledge',type:'function',function:{name:'query_role_knowledge',arguments:JSON.stringify({skillId:payload.plan.skillId,limit:3})}}]},'tool_calls');
 }},{execute:true});
 if(r.mode==='plan-only')throw Error('Expected execution');
 expect(r.mode).toBe('injected-http');expect(r.status).toBe('passed-mechanics');expect(calls).toBe(6);expect(r.httpAttempts).toBe(6);
 expect(r.settledTokens).toBe(780);expect(r.cases.map(c=>c.roleId)).toEqual(['java-backend','web-frontend']);
 expect(r.cases.every(c=>c.requestDigest===digest(c.input))).toBe(true);expect(r.humanReview).toEqual({status:'pending',referenceScores:null,semanticQuality:null});
 expect(r.naturalFollowupVerified).toBe(false);expect(JSON.stringify(r)).not.toContain('synthetic-only');
},15000);
test('first unknown HTTP failure preserves accounting and stops before the other role',async()=>{
 let calls=0;const r=await runBailianAcceptance(ready(),{readCredential:()=> 'synthetic-only',fetch:async()=>{calls++;return new Response('synthetic-only upstream error',{status:500});}},{execute:true});
 if(r.mode==='plan-only')throw Error('Expected execution');
 expect(r.status).toBe('failed');expect(calls).toBe(1);expect(r.cases.length).toBe(1);expect(r.accounting[0]!.entries[0]!.status).toBe('unknown');
 expect(r.heldCostMicros).toBeGreaterThan(0);expect(r.humanReview.semanticQuality).toBeNull();expect(JSON.stringify(r)).not.toContain('synthetic-only');
},15000);
test('CLI needs an explicit execute config and cancellation cannot dispatch a first sample',async()=>{
 expect(parseLiveAcceptanceArgs([])).toMatchObject({execute:false,configPath:undefined});
 expect(()=>parseLiveAcceptanceArgs(['--execute'])).toThrow('ACCEPTANCE_EXPLICIT_CONFIG_REQUIRED');
 expect(()=>parseLiveAcceptanceArgs(['--config','one','--config','two'])).toThrow('ACCEPTANCE_ARGS_INVALID');
 const controller=new AbortController();controller.abort();let reads=0;
 const r=await runBailianAcceptance(ready(),{readCredential:()=>{reads++;return undefined;}},{execute:true,signal:controller.signal});
 if(r.mode==='plan-only')throw Error('Expected execution');
 expect(r.status).toBe('cancelled');expect(r.httpAttempts).toBe(0);expect(reads).toBe(0);expect(r.cases).toEqual([]);
});

test('verified Qianwen endpoint is separate from Bailian and cannot expand into arbitrary hosts',()=>{
 const p={...config.profile,providerId:'qianwen',endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1'};
 expect(LiveModelProfileSchema.safeParse(p).success).toBe(true);
 expect(LiveModelProfileSchema.safeParse({...p,providerId:'bailian'}).success).toBe(false);
 expect(LiveModelProfileSchema.safeParse({...p,endpoint:'https://other.qianwenaiapi.com/compatible-mode/v1'}).success).toBe(false);
 expect(LiveModelProfileSchema.safeParse({...p,endpoint:'https://maas.qianwenaiapi.com.evil.test/compatible-mode/v1'}).success).toBe(false);
});

test('acceptance preparation exposes aggregate scope and does not authorize the disabled example',()=>{
 expect(prepareBailianAcceptance({...config,planning:'pi-knowledge'})).toMatchObject({
  suiteId:'bailian-smoke-v1',sampleCount:2,readyToExecute:false,credentialInspection:'not-performed',
  networkAccess:'not-performed',limits:{maxHttpAttempts:6,maxDeclaredCostMicros:300000,currency:'CNY'},
  semanticQuality:'pending-human-review',naturalFollowupVerified:false,
 });
});
