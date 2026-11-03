import{createInterviewState}from'../../apps/agent/src/planning/interview-state.ts';
import{evaluateTurn}from'../../apps/agent/src/orchestration/evaluate-turn.ts';
export async function makeRetestReport(sessionId='source',questionId='source-q',time=1000000,roleId:'java-backend'|'web-frontend'='java-backend',userId='student-1'){
 const state=createInterviewState({sessionId,roleId,durationMinutes:20,skills:[{skillId:'primary',relevance:1}]},time);
 const rubric={id:'shared-content',version:'1',roleId,scope:'technical-content',criteria:[{id:'correctness',maxScore:4,weight:1,required:true}]};
 const input={state,expectedVersion:0,observationId:`obs-${sessionId}`,goal:'合成复测样例',context:{userId,runId:'r',attemptId:'a',roleId,deadlineAt:time+60000},
  question:{id:questionId,roleId,skillId:'primary',text:'解释一个技术条件',questionType:'technical',difficulty:2},
  answer:{id:`answer-${sessionId}`,text:'技术条件'},quality:1,rubric,knowledge:[]};
 const proposal=await evaluateTurn(input,{now:()=>time+10,evaluate:async()=>({evidence:[{id:'e',start:0,end:4,excerpt:'技术条件'}],
  criterionScores:[{criterionId:'correctness',score:2,evidenceIds:['e']}],feedback:{strengths:['固定样例'],improvements:['练习新场景']}})});
 return{state:proposal.nextState,generatedAt:time+20,policyVersion:'fixture-v0',skillLabels:{primary:'核心技能'},turns:[{input,proposal,evidenceMode:'offline-fixture'}]};
}
