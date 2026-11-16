import{pathToFileURL}from'node:url';
import{acceptanceSample}from'../evals/live-bailian/samples.ts';
import{recordObservation}from'../apps/agent/src/planning/interview-state.ts';
import{selectNextQuestion}from'../apps/agent/src/planning/select-question.ts';
import{deliverQuestion}from'../apps/agent/src/questioning/deliver-question.ts';
import{createPiQuestionDelivery}from'../apps/agent/src/adapters/pi/question-delivery.ts';
import{createEvaluationFixture}from'../experiments/pi-sdk/evaluation-fixture.ts';
import type{RoleId}from'../packages/contracts/src/tools.ts';
/** Real SDK, deterministic bridge provider and hand-authored state observation; no online model calls. */
export async function runQuestionDeliveryDemo(roleId:RoleId='java-backend'){
 const now=Date.now(),request=acceptanceSample(roleId,now,now+60000);if(request.job.type!=='turn')throw Error('Expected turn');
 const input=request.job.input,state=recordObservation(input.state,{observationId:'delivery-demo-observation',roleId,skillId:input.question.skillId,
  questionId:input.question.id,questionType:input.question.questionType,difficulty:input.question.difficulty,score:0.5,quality:1,observedAt:now},input.expectedVersion,now);
 const selection=selectNextQuestion({state,now,knowledge:request.job.knowledge,askedQuestionIds:[input.question.id],planningPolicy:input.planningPolicy},{allowDraftKnowledge:true});
 const excerpt=roleId==='java-backend'?'唯一标识保证幂等':'只让最新请求更新结果和加载状态';
 const f=await createEvaluationFixture(()=>({text:JSON.stringify({bridge:`你刚才提到“${excerpt}”，我们接着换个角度。`,excerpt})}));
 const result=await deliverQuestion({context:request.context,state,selection,previousAnswer:input.answer},{generate:createPiQuestionDelivery({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model})});
 if(selection.status!=='selected'||!result)throw Error('Expected delivery');
 return{roleId,mode:'offline-real-pi-bridge',manualStateObservation:true,result,canonicalText:selection.question.text,
  providerCalls:f.stats.providerCalls,liveModelCalls:0,committed:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){for(const role of ['java-backend','web-frontend']as const)console.log(JSON.stringify(await runQuestionDeliveryDemo(role)));}
