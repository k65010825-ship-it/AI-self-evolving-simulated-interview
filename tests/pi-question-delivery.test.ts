import{test,expect}from'bun:test';
import{createPiQuestionDelivery}from'../apps/agent/src/adapters/pi/question-delivery.ts';
import{deliverQuestion}from'../apps/agent/src/questioning/deliver-question.ts';
import{createEvaluationFixture}from'../experiments/pi-sdk/evaluation-fixture.ts';
import{contentText}from'../experiments/pi-sdk/planner-fixture.ts';
import{deliveryInput}from'./helpers/delivery-input.ts';
test('real Pi delivery has no tools, per-call isolated history and no rubric or identity in the payload',async()=>{
 const fixture=await createEvaluationFixture(context=>{
  const systems=context.messages.filter(m=>m.role==='system');expect(systems.flatMap(m=>m.toolsAdded??[])).toHaveLength(0);
  expect(context.messages.filter(m=>m.role==='user')).toHaveLength(1);expect(context.messages.some(m=>m.role==='assistant')).toBe(false);
  const p=JSON.parse(contentText(context.messages.find(m=>m.role==='user')!.content));
  expect(Object.keys(p).sort()).toEqual(['nextQuestion','previousAnswerText','promptVersion','state']);
  expect(JSON.stringify(p)).not.toContain('synthetic-smoke-user');expect(p).not.toHaveProperty('rubric');
  return{text:JSON.stringify({bridge:'你刚才提到“数据库事务”，我们接着往下看。',excerpt:'数据库事务'})};
 });
 const generate=createPiQuestionDelivery({cwd:process.cwd(),modelRuntime:fixture.runtime,model:fixture.model});
 for(let n=0;n<2;n++)expect(await deliverQuestion(deliveryInput(),{generate})).toMatchObject({status:'generated'});
 expect(fixture.stats.providerCalls).toBe(2);expect(fixture.stats.liveModelCalls).toBe(0);
});
test('Pi bridge rejects malformed, truncated or tool output without retrying or leaking errors',async()=>{
 for(const reply of [{text:'not-json'},{text:'{}'},{text:'{}',stopReason:'length' as const},{text:'',stopReason:'toolUse' as const}]){
  const f=await createEvaluationFixture(()=>reply),generate=createPiQuestionDelivery({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model});
  expect(await deliverQuestion(deliveryInput(),{generate})).toMatchObject({status:'canonical',reason:'invalid-output'});expect(f.stats.providerCalls).toBe(1);
 }
 const f=await createEvaluationFixture(()=>{throw Error('private-provider-detail');});
 await expect(deliverQuestion(deliveryInput(),{generate:createPiQuestionDelivery({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model})})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
});
