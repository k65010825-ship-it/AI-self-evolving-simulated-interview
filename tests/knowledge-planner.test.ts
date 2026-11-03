import{test,expect}from'bun:test';
import{runKnowledgePlannerDemo}from'../scripts/demo-knowledge-planner.ts';
import{createEvaluationFixture}from'../experiments/pi-sdk/evaluation-fixture.ts';
import{plannerReply}from'../experiments/pi-sdk/planner-fixture.ts';
import{createPiQuestionPlanner}from'../apps/agent/src/adapters/pi/question-planner.ts';
import{createInterviewState,recordObservation}from'../apps/agent/src/planning/interview-state.ts';
import{PlannerQuerySchema}from'../packages/contracts/src/knowledge-planner.ts';
import{createOfflineRunManager}from'../apps/agent/src/runtime/offline-runtime.ts';
import{runtimeRequest}from'./helpers/runtime-request.ts';
async function setup(handler:Parameters<typeof createEvaluationFixture>[0]=plannerReply,options:{maxToolCalls?:number;timeoutMs?:number;maxToolCharacters?:number;maxInputCharacters?:number}={}){
 const f=await createEvaluationFixture(handler),now=Date.now();
 const state=createInterviewState({sessionId:'planning',roleId:'java-backend',durationMinutes:20,
  skills:[{skillId:'spring-transactions',relevance:1},{skillId:'java-concurrency',relevance:.9}]},now);
 const input={state,context:{userId:'u',roleId:'java-backend' as const,runId:'p',attemptId:'a',deadlineAt:now+60000},
  goal:'比较累计状态',askedQuestionIds:[] as string[],allowDraftKnowledge:true};
 const plan=createPiQuestionPlanner({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model,...options});return{f,input,plan,now};
}
test('real Pi model fixture queries actual role tool and returns host-validated question IDs',async()=>{
 for(const role of ['java-backend','web-frontend']as const){
  const d=await runKnowledgePlannerDemo(role);expect(d.result.selection.status).toBe('selected');
  expect(d.result.receipts).toHaveLength(1);expect(d.stats.toolCalls).toBe(1);expect(d.stats.providerCalls).toBe(2);expect(d.stats.liveModelCalls).toBe(0);
 }
});

test('cumulative history changes authorized query skill, rather than matching last-answer keywords',async()=>{
 const s=await setup(),initial=await s.plan(s.input);
 const observed=recordObservation(s.input.state,{observationId:'o',roleId:'java-backend',skillId:'spring-transactions',questionId:'prior',questionType:'technical',
  difficulty:2,score:.9,quality:1,observedAt:s.now},0,s.now);
 const next=await s.plan({...s.input,state:observed,planningPolicy:{id:'switch',roleId:'java-backend',parameters:{maxFollowupDepth:0,maxTurns:12,wrapUpSeconds:30}}});
 expect(initial.receipts[0]?.data?.items[0]?.skillId).toBe('spring-transactions');expect(next.receipts[0]?.data?.items[0]?.skillId).toBe('java-concurrency');
});

test('default draft gate and asked IDs produce genuine empty receipts, not fabricated questions',async()=>{
 const s=await setup(),draft=await s.plan({...s.input,allowDraftKnowledge:false});expect(draft.selection.status).toBe('unavailable');expect(draft.receipts[0]?.status).toBe('empty');
 const asked=await s.plan({...s.input,askedQuestionIds:['java-scenario-transactions']});expect(asked.selection.status).toBe('unavailable');expect(asked.receipts[0]?.data?.items).toEqual([]);
});

test('forged IDs, skipped queries and truncated final messages are rejected',async()=>{
 for(const handler of [
  ()=>({text:JSON.stringify({questionId:'invented'})}),
  (ctx:Parameters<typeof plannerReply>[0])=>ctx.messages.some(m=>m.role==='toolResult')?{text:JSON.stringify({questionId:'invented'})}:plannerReply(ctx),
  ()=>({text:'{}',stopReason:'length' as const}),
 ]){const s=await setup(handler);await expect(s.plan(s.input)).rejects.toThrow('MODEL_OUTPUT_INVALID');}
});

test('identity/purpose are not model parameters; cross-skill query and unknown tools cannot bypass host',async()=>{
 expect(PlannerQuerySchema.safeParse({skillId:'spring-transactions',roleId:'web-frontend'}).success).toBe(false);
 expect(PlannerQuerySchema.safeParse({skillId:'spring-transactions',purpose:'scoring'}).success).toBe(false);
 const cross=await setup(()=>({text:'',stopReason:'toolUse',toolCalls:[{type:'toolCall',id:'x',name:'query_role_knowledge',arguments:{skillId:'java-concurrency'}}]}));
 await expect(cross.plan(cross.input)).rejects.toThrow('VALIDATION_ERROR');
 const unknown=await setup(()=>({text:'',stopReason:'toolUse'}));await expect(unknown.plan(unknown.input)).rejects.toThrow('MODEL_OUTPUT_INVALID');
});

test('repeated queries, accumulated tool payload and input size have finite budgets',async()=>{
 const loop=await setup(()=>({text:'',stopReason:'toolUse',toolCalls:[{type:'toolCall',id:crypto.randomUUID(),name:'query_role_knowledge',arguments:{skillId:'spring-transactions'}}]}),{maxToolCalls:1});
 await expect(loop.plan(loop.input)).rejects.toThrow('TOOL_BUDGET_EXCEEDED');
 const tool=await setup(plannerReply,{maxToolCharacters:1});await expect(tool.plan(tool.input)).rejects.toThrow('CONTEXT_BUDGET_EXCEEDED');
 const input=await setup(plannerReply,{maxInputCharacters:1});await expect(input.plan(input.input)).rejects.toThrow('CONTEXT_BUDGET_EXCEEDED');expect(input.f.stats.providerCalls).toBe(0);
});

test('pre-cancel, expired context and wrapup do not invoke a model',async()=>{
 const s=await setup(),controller=new AbortController();controller.abort();await expect(s.plan(s.input,controller.signal)).rejects.toThrow('RUN_CANCELLED');
 await expect(s.plan({...s.input,context:{...s.input.context,deadlineAt:1}})).rejects.toThrow('DEADLINE_EXCEEDED');
 const result=await s.plan({...s.input,planningPolicy:{id:'end',roleId:'java-backend',parameters:{maxTurns:1,maxFollowupDepth:2,wrapUpSeconds:300}},
  state:{...s.input.state,deadlineAt:Date.now()+1000}});expect(result.selection.status).toBe('finished');expect(s.f.stats.providerCalls).toBe(0);
});

test('inflight cancellation and timeout reject late provider output',async()=>{
 let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
 const s=await setup(async()=>{entered();return new Promise(()=>{});}),controller=new AbortController();
 const work=s.plan(s.input,controller.signal);await started;controller.abort();await expect(work).rejects.toThrow('RUN_CANCELLED');
 const timeout=await setup(async()=>new Promise(()=>{}),{timeoutMs:10});await expect(timeout.plan(timeout.input)).rejects.toThrow('DEADLINE_EXCEEDED');
});

test('runtime can explicitly opt in without changing default deterministic selection',async()=>{
 const runtime=await createOfflineRunManager({planning:'pi-knowledge'});const input=runtimeRequest('planner-runtime');
 runtime.start(input);await runtime.wait(input.context.runId);const snapshot=runtime.snapshot(input.context.runId);
 expect(snapshot.status).toBe('completed');if(snapshot.result?.kind!=='uncommitted-turn-result')throw new Error('Expected result');
 expect(snapshot.result.planning?.receipts).toHaveLength(1);expect(snapshot.result.selection.status).toBe('selected');runtime.dispose();
});

test('four calls in one assistant message cannot bypass the total tool budget',async()=>{
 const s=await setup(()=>({text:'',stopReason:'toolUse',toolCalls:Array.from({length:4},(_,i)=>({type:'toolCall' as const,id:`q${i}`,
  name:'query_role_knowledge',arguments:{skillId:'spring-transactions'}}))}));
 await expect(s.plan(s.input)).rejects.toThrow('TOOL_BUDGET_EXCEEDED');expect(s.f.stats.providerCalls).toBe(1);
});
