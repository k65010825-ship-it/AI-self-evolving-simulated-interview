import{createInterviewState,recordObservation}from'../../apps/agent/src/planning/interview-state.ts';
import java from'../../knowledge/java-backend/seed.json'with{type:'json'};
export function runtimeRequest(id='run-1'){
 const base=Date.now();
 let state=createInterviewState({sessionId:'session',roleId:'java-backend',durationMinutes:20,
  skills:[{skillId:'spring-transactions',relevance:1},{skillId:'java-concurrency',relevance:0.1}]},base);
 state=recordObservation(state,{observationId:'o0',roleId:'java-backend',skillId:'spring-transactions',questionId:'prior-q',
  questionType:'technical',difficulty:1,score:0.25,quality:1,observedAt:base},0,base);
 const context={userId:'u',runId:id,attemptId:'attempt-1',roleId:'java-backend',deadlineAt:base+60000};
 return{inputSnapshotId:`snapshot-${id}`,context,job:{type:'turn',input:{state,expectedVersion:1,observationId:'o1',goal:'运行测试',context,
  question:{id:'current-q',roleId:'java-backend',skillId:'spring-transactions',questionType:'technical',difficulty:1,text:'解释事务边界'},
  answer:{id:'a1',text:'事务边界'},quality:1,knowledge:[],rubric:{id:'rubric',version:'1',roleId:'java-backend',scope:'technical-content',
   criteria:[{id:'correctness',maxScore:4,weight:1,required:true}]},planningPolicy:{id:'pin-1',roleId:'java-backend',
   parameters:{maxFollowupDepth:1,maxTurns:12,wrapUpSeconds:30}}},knowledge:java,askedQuestionIds:[],allowDraftKnowledge:true}};
}
