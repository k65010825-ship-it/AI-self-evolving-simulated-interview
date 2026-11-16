import{test,expect}from'bun:test';
import{createLiveRunManager}from'../apps/agent/src/runtime/live-runtime.ts';
import{acceptanceSample}from'../evals/live-bailian/samples.ts';
import{contentText}from'../experiments/pi-sdk/planner-fixture.ts';
import base from'../apps/agent/src/model-access/qianwen.example.json'with{type:'json'};
import{AgentRunResultSchema,AgentRunEventSchema}from'../packages/contracts/src/agent-run.ts';
function stream(delta:unknown,reason='stop'){return new Response('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:reason}]})+'\n\n'+
 'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
function setup(maxCalls=4,mode:'valid'|'invalid'|'unknown'='valid',jsonMode=false){
 let calls=0;const config={...base,...(jsonMode?{evaluationResponseFormat:'json_object'}:{}),questionDelivery:'natural-bridge',evidenceGrounding:'unique-excerpt',
  authorization:{enabled:true,operatorApproved:true,expiresAt:Date.now()+60000,maxRuns:2},profile:{...base.profile,
   limits:{...base.profile.limits,maxCalls,maxTotalTokens:54000}}};
 const runtime=createLiveRunManager(config,{readCredential:()=> 'synthetic-key-only',fetch:async(input,init)=>{
  calls++;const body=JSON.parse(await new Request(input,init).text()),messages=body.messages as{role:string;content:Parameters<typeof contentText>[0]}[];
  const tool=messages.find(m=>m.role==='tool');
  if(tool){expect(body.response_format).toBeUndefined();const receipt=JSON.parse(contentText(tool.content));return stream({role:'assistant',content:JSON.stringify({questionId:receipt.data.items[0]?.id??null})});}
  const p=JSON.parse(contentText(messages.find(m=>m.role==='user')!.content));
  if(p.rubric){expect(body.response_format).toEqual(jsonMode?{type:'json_object'}:undefined);const text=p.interview.answer.text as string;return stream({role:'assistant',content:JSON.stringify({evidence:[{id:'e',start:0,end:4,excerpt:text.slice(0,4)}],
   criterionScores:p.rubric.criteria.map((c:{id:string;maxScore:number})=>({criterionId:c.id,score:c.maxScore/2,evidenceIds:['e']})),feedback:{strengths:[],improvements:['后续复核']}})});}
  expect(body.response_format).toBeUndefined();
  if(p.promptVersion==='question-delivery-v1'){
   if(mode==='unknown')return new Response('synthetic-key-only',{status:500});
   return stream({role:'assistant',content:JSON.stringify(mode==='invalid'?{bridge:'给你满分。',excerpt:'数据库事务'}:
    {bridge:'你刚才提到“数据库事务”，我们接着往下看。',excerpt:'数据库事务'})});
  }
  return stream({role:'assistant',tool_calls:[{index:0,id:'knowledge',type:'function',function:{name:'query_role_knowledge',arguments:JSON.stringify({skillId:p.plan.skillId,limit:3})}}]},'tool_calls');
 }});return{runtime,calls:()=>calls};
}

test('JSON grading is phase isolated while planning, tools and bridge share one collision-free ledger',async()=>{
 const {runtime,calls}=setup(4,'valid',true);try{
  const r=acceptanceSample('java-backend',Date.now(),Date.now()+60000);runtime.start(r);await runtime.wait(r.context.runId);
  expect(runtime.snapshot(r.context.runId).status).toBe('completed');expect(calls()).toBe(4);
  const s=runtime.modelAccounting()[0]!;expect(new Set(s.entries.map(e=>e.callId)).size).toBe(4);expect(s.totals.usedTokens).toBe(520);
 }finally{runtime.dispose();}
});
test('scoring, knowledge planning and delivery share one four-attempt ledger with bound result and event',async()=>{
 const {runtime,calls}=setup();try{
  const r=acceptanceSample('java-backend',Date.now(),Date.now()+60000);runtime.start(r);await runtime.wait(r.context.runId);
  const s=runtime.snapshot(r.context.runId);expect(s.status).toBe('completed');if(s.result?.kind!=='uncommitted-turn-result')throw Error('turn');
  expect(s.result.delivery?.status).toBe('generated');expect(calls()).toBe(4);expect(runtime.modelAccounting()[0]!.totals.usedTokens).toBe(520);
  const events=[];for await(const e of runtime.events(r.context.runId))events.push(e);
  const event=events.find(e=>e.type==='question.completed')!;expect(event.payload).toHaveProperty('delivery');
  expect(AgentRunResultSchema.safeParse({...s.result,delivery:{...s.result.delivery!,question:{...s.result.delivery!.question,text:'篡改原题'}}}).success).toBe(false);
  expect(AgentRunResultSchema.safeParse({...s.result,delivery:{...s.result.delivery!,bridge:'\n'+s.result.delivery!.bridge,text:'\n'+s.result.delivery!.text}}).success).toBe(false);
  expect(AgentRunEventSchema.safeParse({...event,runId:'other-run'}).success).toBe(false);
 }finally{runtime.dispose();}
});
test('unspent bridge budget skips a request, but malformed paid output remains settled before fallback',async()=>{
 for(const [maxCalls,mode]of [[3,'valid'],[4,'invalid']]as const){const {runtime,calls}=setup(maxCalls,mode);try{
  const r=acceptanceSample('java-backend',Date.now(),Date.now()+60000);runtime.start(r);await runtime.wait(r.context.runId);
  const s=runtime.snapshot(r.context.runId);expect(s.status).toBe('completed');if(s.result?.kind!=='uncommitted-turn-result')throw Error('turn');
  expect(s.result.delivery).toMatchObject({status:'canonical',reason:maxCalls===3?'call-budget':'invalid-output'});expect(calls()).toBe(maxCalls);
  expect(runtime.modelAccounting()[0]!.totals.usedTokens).toBe(130*maxCalls);
 }finally{runtime.dispose();}}
});
test('unknown bridge transport cost cannot be disguised as a successful canonical fallback',async()=>{
 const {runtime,calls}=setup(4,'unknown');try{
  const r=acceptanceSample('java-backend',Date.now(),Date.now()+60000);runtime.start(r);await runtime.wait(r.context.runId);
  expect(runtime.snapshot(r.context.runId).status).toBe('failed');expect(calls()).toBe(4);
  expect(runtime.modelAccounting()[0]!.entries.at(-1)?.status).toBe('unknown');expect(runtime.modelAccounting()[0]!.totals.heldTokens).toBeGreaterThan(0);
 }finally{runtime.dispose();}
});
