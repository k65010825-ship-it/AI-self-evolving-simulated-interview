import{createEvaluationFixture}from'../../../../experiments/pi-sdk/evaluation-fixture.ts';
import{createPiEvaluator}from'../adapters/pi/evaluator.ts';
import{createRunManager}from'./run-manager.ts';
import type{RoleId}from'../../../../packages/contracts/src/tools.ts';
import{createPiQuestionPlanner}from'../adapters/pi/question-planner.ts';
import{createPlannerFixture}from'../../../../experiments/pi-sdk/planner-fixture.ts';
/** Explicit development fixture only. No personal credentials or network model provider. */
export async function createOfflineRunManager(options:{planning?:'deterministic'|'pi-knowledge'}={}){
 if(options.planning!==undefined&&!['deterministic','pi-knowledge'].includes(options.planning))throw new Error('Invalid offline planning mode');
 const planners=new Map<RoleId,ReturnType<typeof createPiQuestionPlanner>>();
 const evaluators=new Map<RoleId,ReturnType<typeof createPiEvaluator>>();
 for(const roleId of ['java-backend','web-frontend']as const){
  if(options.planning==='pi-knowledge'){
   const p=await createPlannerFixture();planners.set(roleId,createPiQuestionPlanner({cwd:process.cwd(),modelRuntime:p.runtime,model:p.model}));
  }
  const fixture=await createEvaluationFixture(context=>{
   const user=context.messages.filter(m=>m.role==='user').at(-1);
   if(!user)throw new Error('Missing fixture input');
   const text=typeof user.content==='string'?user.content:user.content.filter(c=>c.type==='text').map(c=>c.text).join('');
   const input=JSON.parse(text)as{interview:{answer:{text:string}};rubric:{criteria:{id:string;maxScore:number}[]}};
   const answer=input.interview.answer.text,end=Math.min(4,answer.length);
   return{text:JSON.stringify({evidence:[{id:'e1',start:0,end,excerpt:answer.slice(0,end)}],
    criterionScores:input.rubric.criteria.map(c=>({criterionId:c.id,score:c.maxScore*0.5,evidenceIds:['e1']})),
    feedback:{strengths:['离线替身固定反馈'],improvements:['后续用真实模型与人工参考检验质量']}})};
  });
  evaluators.set(roleId,createPiEvaluator({cwd:process.cwd(),modelRuntime:fixture.runtime,model:fixture.model,roleId}));
 }
 return createRunManager({evaluateForRole:role=>evaluators.get(role)!,...(planners.size?{planForRole:(role:RoleId)=>planners.get(role)!}:{})});
}
