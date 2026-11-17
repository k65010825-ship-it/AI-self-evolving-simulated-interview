import {test,expect} from 'bun:test';
import {deliverQuestion} from '../apps/agent/src/questioning/deliver-question.ts';
import {deliveryInput} from './helpers/delivery-input.ts';
import {createEvaluationFixture} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {createPiQuestionDelivery} from '../apps/agent/src/adapters/pi/question-delivery.ts';
test('a real excerpt does not authorize invented praise, student facts, conclusions or answer leakage',async()=>{
 for(const bridge of ['你刚才提到数据库事务，看来你的基础很扎实。','你提到数据库事务，你已经掌握了隔离级别。',
  '你提到数据库事务，你在项目中使用过两阶段提交。','你提到数据库事务，关键在于读写锁和重试。',
  '你提到数据库事务，现在转向CAS与ABA。']){
  const out=await deliverQuestion(deliveryInput(),{generate:async()=>({bridge,excerpt:'数据库事务'})});
  expect(out).toMatchObject({status:'canonical',reason:'invalid-output',text:deliveryInput().selection.question.text});
 }
});
test('unique literal quotation and a closed neutral envelope survive without changing the question',async()=>{
 for(const excerpt of ['请求','CAS.*(x)','事务🦊边界']){
  const i=deliveryInput();i.previousAnswer.text='我提及'+excerpt+'这一概念。';
  expect(await deliverQuestion(i,{generate:async()=>({bridge:`你刚才提到“${excerpt}”，我们继续往下看。`,excerpt})})).toMatchObject({status:'generated',question:i.selection.question});
 }
 const i=deliveryInput();i.previousAnswer.text='甲甲甲';
 expect(await deliverQuestion(i,{generate:async()=>({bridge:'你提到甲甲。',excerpt:'甲甲'})})).toMatchObject({reason:'invalid-output'});
});
test('Pi Stop rejects a superficially valid bridge before host publication, without retry',async()=>{
 const f=await createEvaluationFixture(()=>({text:JSON.stringify({bridge:'你提到数据库事务，你的项目经验丰富。',excerpt:'数据库事务'})}));
 const generate=createPiQuestionDelivery({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model});
 expect(await deliverQuestion(deliveryInput(),{generate})).toMatchObject({status:'canonical',reason:'invalid-output'});
 expect(f.stats.providerCalls).toBe(1);expect(f.stats.liveModelCalls).toBe(0);
});
