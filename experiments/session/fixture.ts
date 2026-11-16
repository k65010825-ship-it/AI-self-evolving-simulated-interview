import{createPlannerFixture,contentText}from'../pi-sdk/planner-fixture.ts';
import{createEvaluationFixture}from'../pi-sdk/evaluation-fixture.ts';
import{createPiQuestionPlanner}from'../../apps/agent/src/adapters/pi/question-planner.ts';
import{createPiEvaluator}from'../../apps/agent/src/adapters/pi/evaluator.ts';
import type{RoleId}from'../../packages/contracts/src/tools.ts';
import{createPiQuestionDelivery}from'../../apps/agent/src/adapters/pi/question-delivery.ts';
export async function createWorkflowFixture(roleId:RoleId='java-backend',options:{delivery?:boolean;injectInvalidEvaluationOnce?:boolean}={}){
 const faults={injectedInvalidEvaluations:0};
 const planning=await createPlannerFixture();
 const scoring=await createEvaluationFixture(context=>{
  if(options.injectInvalidEvaluationOnce&&faults.injectedInvalidEvaluations===0){faults.injectedInvalidEvaluations++;return{text:'synthetic-invalid-json'};}
  const input=JSON.parse(contentText(context.messages.filter(m=>m.role==='user').at(-1)!.content))as{
   interview:{answer:{text:string}};rubric:{criteria:{id:string;maxScore:number}[]}};
  const text=input.interview.answer.text;
  return{text:JSON.stringify({evidence:[{id:'e',start:0,end:Math.min(4,text.length),excerpt:text.slice(0,4)}],
   criterionScores:input.rubric.criteria.map(c=>({criterionId:c.id,score:c.maxScore/2,evidenceIds:['e']})),
   feedback:{strengths:['离线手工评分'],improvements:['人工参考集尚需验证']}})};
 });
 const delivery=options.delivery?await createEvaluationFixture(context=>{
  const input=JSON.parse(contentText(context.messages.filter(m=>m.role==='user').at(-1)!.content)),excerpt=(input.previousAnswerText as string).slice(0,4);
  return{text:JSON.stringify({bridge:`你刚才提到“${excerpt}”，我们继续往下看。`,excerpt})};
 }):undefined;
 return{plan:createPiQuestionPlanner({cwd:process.cwd(),modelRuntime:planning.runtime,model:planning.model}),
  evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:scoring.runtime,model:scoring.model,roleId}),
  ...(delivery?{deliver:createPiQuestionDelivery({cwd:process.cwd(),modelRuntime:delivery.runtime,model:delivery.model})}:{}),
  stats:{planning:planning.stats,scoring:scoring.stats,faults,...(delivery?{delivery:delivery.stats}:{})}};
}
