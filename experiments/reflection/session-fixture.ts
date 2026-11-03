import {createInterviewState} from '../../apps/agent/src/planning/interview-state.ts';
import {evaluateTurn} from '../../apps/agent/src/orchestration/evaluate-turn.ts';
export async function createReflectionFixture(roleId:'java-backend'|'web-frontend'='java-backend',depth=2,count=3,difficulty=1){
 const now=1000000;
 const baselinePolicy={id:'policy-v0',roleId,parameters:{maxFollowupDepth:depth,wrapUpSeconds:30,maxTurns:12}};
 let state=createInterviewState({sessionId:'reflection-session',roleId,durationMinutes:20,
  skills:[{skillId:'primary',relevance:1},{skillId:'secondary',relevance:0.1},{skillId:'third',relevance:0.1}]},now);
 const turns=[];
 for(let i=0;i<count;i++){
  const input={state,expectedVersion:state.version,observationId:`o${i}`,goal:'离线反思样例',
   context:{userId:'demo',runId:`run${i}`,attemptId:'a',roleId,deadlineAt:now+60000},
   question:{id:`q${i}`,roleId,skillId:'primary',text:'说明一个技术边界',questionType:'technical',difficulty},
   answer:{id:`a${i}`,text:'边界条件'},quality:1,knowledge:[],planningPolicy:baselinePolicy,
   rubric:{id:'fixture-rubric',version:'1',roleId,scope:'technical-content',criteria:[{id:'correctness',maxScore:4,weight:1,required:true}]}};
  const proposal=await evaluateTurn(input,{now:()=>now+i*1000,evaluate:async()=>({
   evidence:[{id:'e',start:0,end:4,excerpt:'边界条件'}],criterionScores:[{criterionId:'correctness',score:1,evidenceIds:['e']}],
   feedback:{strengths:['本地固定反馈'],improvements:['补充其他技能诊断']}})});
  turns.push({input,proposal,evidenceMode:'offline-fixture'});state=proposal.nextState;
 }
 return {reportInput:{state,generatedAt:now+count*1000,policyVersion:baselinePolicy.id,
  skillLabels:{primary:'核心技能',secondary:'第二技能',third:'第三技能'},turns},baselinePolicy,
  generatedAt:now+(count+1)*1000,sourceGroupId:'development-session-group'};
}
