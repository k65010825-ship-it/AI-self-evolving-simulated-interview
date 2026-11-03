import{pathToFileURL}from'node:url';
import{createPairFixture}from'../experiments/learning/pair-fixture.ts';
import{recordLearningEvent,summarizeLearning}from'../apps/agent/src/learning/progress.ts';
import{pairRetest,summarizeCalibration}from'../apps/agent/src/learning/retest-pair.ts';
import type{RoleId}from'../packages/contracts/src/tools.ts';
export async function runLearningRetestDemo(roleId:RoleId='java-backend'){
 const first=await createPairFixture(roleId),identity={userId:first.request.userId,roleId,assignmentId:first.request.assignmentId};
 const click=recordLearningEvent(first.empty,{...identity,expectedVersion:0,now:1001500,event:{id:'click',kind:'resource_clicked',occurredAt:1001500,resourceId:'r1'}});
 const clickPair=await pairRetest({...first.request,progress:click}),verifiedPair=await pairRetest(first.request);
 const cohort={roleId,skillId:'primary',dataMode:'synthetic',predictorVersion:'predictor-v0',targetDifficulty:2,targetRubric:first.request.prediction.target.rubric};
 const single=summarizeCalibration({...cohort,pairs:[verifiedPair]}),pairs=[];
 for(let i=0;i<8;i++){const f=await createPairFixture(roleId,`synthetic-student-${i%2}`,`-sample-${i}`);pairs.push(await pairRetest(f.request));}
 return{mode:'synthetic-learning-and-retest',liveModelCalls:0,committed:false,prediction:first.request.prediction,
  clickSummary:summarizeLearning(click,identity),verifiedSummary:summarizeLearning(first.request.progress,identity),clickPair,verifiedPair,
  singleSummary:single,syntheticBatchSummary:summarizeCalibration({...cohort,pairs})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const role of ['java-backend','web-frontend']as const)console.log(JSON.stringify(await runLearningRetestDemo(role),null,2));
}
