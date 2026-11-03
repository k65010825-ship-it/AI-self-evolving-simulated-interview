import{pathToFileURL}from'node:url';
import{createPlannerFixture}from'../experiments/pi-sdk/planner-fixture.ts';
import{createPiQuestionPlanner}from'../apps/agent/src/adapters/pi/question-planner.ts';
import{createInterviewState}from'../apps/agent/src/planning/interview-state.ts';
import type{RoleId}from'../packages/contracts/src/tools.ts';
export async function runKnowledgePlannerDemo(roleId:RoleId='java-backend'){
 const now=Date.now(),skillId=roleId==='java-backend'?'spring-transactions':'async-state';
 const state=createInterviewState({sessionId:'planner-demo',roleId,durationMinutes:20,skills:[{skillId,relevance:1}]},now);
 const fixture=await createPlannerFixture();
 const plan=createPiQuestionPlanner({cwd:process.cwd(),modelRuntime:fixture.runtime,model:fixture.model});
 const result=await plan({state,context:{userId:'fixture-student',roleId,runId:'planner-run',attemptId:'a1',deadlineAt:now+60000},
  goal:'查询岗位知识并提出下一题',askedQuestionIds:[],allowDraftKnowledge:true});
 return{roleId,result,stats:{...fixture.stats,toolCalls:result.receipts.length},committed:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const role of ['java-backend','web-frontend']as const){const d=await runKnowledgePlannerDemo(role);console.log(JSON.stringify({role,stats:d.stats,
  status:d.result.selection.status,question:d.result.selection.status==='selected'?d.result.selection.question:null,committed:false},null,2));}
}
