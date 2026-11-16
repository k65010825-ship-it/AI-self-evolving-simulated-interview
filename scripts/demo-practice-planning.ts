import { pathToFileURL } from 'node:url';
import { makeRetestReport } from '../experiments/learning/retest-fixture.ts';
import { createMemory,appendMemory,startSessionFromMemory } from '../apps/agent/src/memory/session-memory.ts';
import { buildPracticeGoals } from '../apps/agent/src/learning/practice-plan.ts';
import { createLearningProgress,recordLearningEvent } from '../apps/agent/src/learning/progress.ts';
import { createPrediction,pairRetest } from '../apps/agent/src/learning/retest-pair.ts';
import { planRetestQuestion } from '../apps/agent/src/learning/plan-retest.ts';
import { evaluateTurn } from '../apps/agent/src/orchestration/evaluate-turn.ts';
import type { RoleId } from '../packages/contracts/src/tools.ts';
export async function runPracticePlanningDemo(roleId:RoleId='java-backend'){
 const t=1000000,identity={userId:'practice-fixture',roleId},source=await makeRetestReport('practice-source','practice-old-q',t,roleId,identity.userId);
 const memory=await appendMemory(createMemory(identity,t+100),{...identity,expectedVersion:0,sessionStatus:'completed',now:t+100,reportInput:source});
 const session={sessionId:'practice-next',roleId,durationMinutes:20,skills:[{skillId:'primary',relevance:1}]};
 const goals=buildPracticeGoals(memory,{...identity,session,now:t+200}),goal=goals.goals[0];if(!goal)throw Error('PRACTICE_DEMO_FAILED');
 const learningIdentity={...identity,assignmentId:'practice-assignment'};
 const empty=createLearningProgress({...learningIdentity,skillId:goal.skillId,resourceIds:['r'],requiredExerciseIds:['x'],dataMode:'synthetic',now:t+300});
 const prediction=await createPrediction({...learningIdentity,predictionId:'practice-prediction',progress:empty,sourceReportInput:source,
  sourceAnswerId:'answer-practice-source',issuedAt:t+300,validUntil:t+10000,predictedTargetScore:.6,predictorVersion:'synthetic-v1',
  target:{difficulty:2,rubric:source.turns[0]!.input.rubric}});
 const progress=recordLearningEvent(empty,{...learningIdentity,expectedVersion:0,now:t+400,event:{id:'verified',kind:'practice_verified',occurredAt:t+400,
  exerciseId:'x',verification:{artifactId:'synthetic-proof',verifierId:'synthetic-verifier',verifiedAt:t+400}}});
 const state=startSessionFromMemory(memory,{...identity,session,now:t+500});
 const candidates=['practice-old-q','practice-unseen-q'].map(id=>({question:{...source.turns[0]!.input.question,id,text:'解释另一种边界情况'},
  rubric:structuredClone(prediction.target.rubric),source:{knowledgeId:id,version:'synthetic-1',sourceIds:['synthetic-source'],reviewStatus:'draft'}}));
 const request={...learningIdentity,prediction,progress,state,now:t+500,askedQuestionIds:[],candidates,allowDraftKnowledge:true};
 const blocked=planRetestQuestion({...request,progress:empty}),ready=planRetestQuestion(request);
 if(ready.status!=='ready')throw Error('PRACTICE_DEMO_FAILED');
 const input={state,expectedVersion:state.version,observationId:'practice-observation',goal:'不同题复练',context:{...identity,runId:'practice-run',attemptId:'a',deadlineAt:t+10000},
  question:ready.candidate.question,rubric:ready.candidate.rubric,answer:{id:'practice-answer',text:'技术条件'},quality:1,knowledge:[]};
 const proposal=await evaluateTurn(input,{now:()=>t+510,evaluate:async()=>({evidence:[{id:'e',start:0,end:4,excerpt:'技术条件'}],
  criterionScores:[{criterionId:'correctness',score:2,evidenceIds:['e']}],feedback:{strengths:['合成固定回答'],improvements:['补充边界']}})});
 const retestReportInput={state:proposal.nextState,generatedAt:t+520,policyVersion:'synthetic-v1',skillLabels:{primary:'核心技能'},turns:[{input,proposal,evidenceMode:'offline-fixture'}]};
 const pair=await pairRetest({...learningIdentity,prediction,progress,retestReportInput,retestAnswerId:input.answer.id,questionIssuedAt:t+500,answerSubmittedAt:t+505,
  now:t+600,dataMode:'synthetic',reference:{basis:'synthetic-fixture',reviewId:'synthetic-review',reviewerId:'synthetic-reviewer',answerId:input.answer.id,
   rubricId:input.rubric.id,rubricVersion:input.rubric.version,score:.5,reviewedAt:t+530}});
 if(pair.status!=='eligible'||blocked.status!=='blocked')throw Error('PRACTICE_DEMO_FAILED');
 return{roleId,scope:'synthetic-practice-to-retest',goal:{skillId:goal.skillId,reason:goal.reason,mastery:goal.mastery,confidence:goal.confidence,memoryVersion:goals.memoryVersion},
  blockedReasons:blocked.reasons,plan:{status:ready.status,questionId:ready.candidate.question.id,excluded:ready.excluded,basedOn:ready.basedOn},
  pair:{status:pair.status,reasons:pair.reasons,absoluteError:pair.absoluteError},liveModelCalls:0,formalCommitted:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length>2)throw Error('PRACTICE_ARGS_INVALID');for(const role of ['java-backend','web-frontend']as const)console.log(JSON.stringify(await runPracticePlanningDemo(role)));}
 catch{console.error('PRACTICE_DEMO_FAILED');process.exitCode=1;}
}
