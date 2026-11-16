import{test,expect}from'bun:test';
import{deliverQuestion}from'../apps/agent/src/questioning/deliver-question.ts';
import{acceptanceSample}from'../evals/live-bailian/samples.ts';
import{AgentStateError}from'../apps/agent/src/planning/interview-state.ts';

function input(){const now=Date.now(),r=acceptanceSample('java-backend',now,now+60000);
 if(r.job.type!=='turn')throw Error('turn');
 return{context:r.context,state:r.job.input.state,previousAnswer:r.job.input.answer,selection:{status:'selected',
  plan:{action:'switch_skill',skillId:r.job.input.question.skillId,difficulty:r.job.input.question.difficulty,remainingSeconds:1200,reason:'host'},
  question:r.job.input.question,rubric:r.job.input.rubric,source:{knowledgeId:r.job.input.question.id,version:r.job.input.rubric.version,sourceIds:['s'],reviewStatus:'draft'}}};}
test('natural delivery appends the exact canonical question and never changes its source state or rubric',async()=>{
 const i=input(),before=structuredClone(i);const out=await deliverQuestion(i,{generate:async()=>({bridge:'你刚才提到“数据库事务”，接下来我们换个角度。',excerpt:'数据库事务'})});
 expect(out).toMatchObject({status:'generated',reason:'generated',question:i.selection.question,semanticReview:'pending',
  text:'你刚才提到“数据库事务”，接下来我们换个角度。\n'+i.selection.question.text});
 expect(i).toEqual(before);
});
test('unavailable, finished, disabled and insufficient time never invoke the model',async()=>{
 let calls=0;const generate=async()=>{calls++;throw Error('must not call');},i=input();
 expect(await deliverQuestion({...i,selection:{status:'finished',plan:{...i.selection.plan,action:'finish',skillId:null}}},{generate})).toBeUndefined();
 expect(await deliverQuestion(i,{})).toMatchObject({status:'canonical',reason:'disabled',text:i.selection.question.text});
 const close={...i,context:{...i.context,deadlineAt:Date.now()+1000}};
 expect(await deliverQuestion(close,{generate})).toMatchObject({status:'canonical',reason:'time-budget'});expect(calls).toBe(0);
});
test('invalid surface, fabricated/ambiguous quotes and injected fields fall back to the canonical question',async()=>{
 const replies=[{bridge:'你刚才提到数据库事务，为什么呢？',excerpt:'数据库事务'},
  {bridge:'数据库事务的正确答案是重试。',excerpt:'数据库事务'},
  {bridge:'你提到数据库事务。',excerpt:'数据库事务',question:'改题'},
  {bridge:'你提到事务这个概念。',excerpt:'事务'},
  {bridge:'你提到不存在的细节。',excerpt:'不存在的细节'},
  {bridge:'你提到其他话题。',excerpt:'数据库事务'}];
 for(const reply of replies){const i=input();if(reply.excerpt==='事务')i.previousAnswer.text='事务事务';
  const out=await deliverQuestion(i,{generate:async()=>reply});expect(out).toMatchObject({status:'canonical',reason:'invalid-output',bridge:null,text:i.selection.question.text});
 }
 let calls=0;const i=input();await expect(deliverQuestion({...i,context:{...i.context,roleId:'web-frontend'}},{generate:async()=>{calls++;return{};}})).rejects.toThrow('VALIDATION_ERROR');expect(calls).toBe(0);
});
test('cancellation and timeout never return a fallback success, and unknown errors stay sanitized',async()=>{
 const c=new AbortController();c.abort();let calls=0;
 await expect(deliverQuestion(input(),{signal:c.signal,generate:async()=>{calls++;return{};}})).rejects.toThrow('RUN_CANCELLED');expect(calls).toBe(0);
 let entered!:()=>void,release!:(v:unknown)=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),running=new AbortController();
 const work=deliverQuestion(input(),{signal:running.signal,generate:async()=>{entered();return new Promise(resolve=>{release=resolve;});}});
 await started;running.abort();await expect(work).rejects.toThrow('RUN_CANCELLED');release({bridge:'你提到数据库事务。',excerpt:'数据库事务'});
 await expect(deliverQuestion(input(),{timeoutMs:10,generate:async()=>new Promise(()=>{})})).rejects.toThrow('DEADLINE_EXCEEDED');
 await expect(deliverQuestion(input(),{generate:async()=>{throw Error('private-upstream-message');}})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
});
test('only validated output rejection or unspent call budget can yield a canonical fallback',async()=>{
 expect(await deliverQuestion(input(),{generate:async()=>{throw new AgentStateError('MODEL_OUTPUT_INVALID');}})).toMatchObject({reason:'invalid-output'});
 expect(await deliverQuestion(input(),{generate:async()=>{throw new AgentStateError('TOOL_BUDGET_EXCEEDED');}})).toMatchObject({reason:'call-budget'});
 await expect(deliverQuestion(input(),{generate:async()=>{throw new AgentStateError('DEPENDENCY_UNAVAILABLE');}})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
});
test('neutral quoted request text is allowed without treating 请求 as an imperative 请',async()=>{
 const i=input();i.previousAnswer.text='请求按顺序返回。';
 expect(await deliverQuestion(i,{generate:async()=>({bridge:'你刚才提到“请求”，我们接着往下看。',excerpt:'请求'})})).toMatchObject({status:'generated'});
 expect(await deliverQuestion(input(),{generate:async()=>({bridge:'请先聊聊数据库事务。',excerpt:'数据库事务'})})).toMatchObject({status:'canonical',reason:'invalid-output'});
});
test('presentation cannot spend a pinned wrap-up reserve on model generation',async()=>{
 const i=input(),now=Date.now();i.state.deadlineAt=now+100000;i.selection.plan.remainingSeconds=100;let calls=0;
 expect(await deliverQuestion({...i,wrapUpSeconds:90},{timeoutMs:20000,generate:async()=>{calls++;return{};}})).toMatchObject({status:'canonical',reason:'time-budget'});
 expect(calls).toBe(0);
});
test('a synchronous generator cannot bypass its timeout before the timer callback runs',async()=>{
 let at=Date.now();const i=input();
 await expect(deliverQuestion(i,{now:()=>at,timeoutMs:100,generate:async()=>{at+=101;return{bridge:'你提到数据库事务。',excerpt:'数据库事务'};}})).rejects.toThrow('DEADLINE_EXCEEDED');
});
