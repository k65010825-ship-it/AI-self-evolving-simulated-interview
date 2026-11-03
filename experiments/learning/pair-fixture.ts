import{createLearningProgress,recordLearningEvent}from'../../apps/agent/src/learning/progress.ts';
import{createPrediction}from'../../apps/agent/src/learning/retest-pair.ts';
import{makeRetestReport}from'./retest-fixture.ts';
export async function createPairFixture(roleId:'java-backend'|'web-frontend'='java-backend',userId='student-1',suffix=''){
 const source=await makeRetestReport(`source${suffix}`,`source-q${suffix}`,1000000,roleId,userId);
 const identity={userId,roleId,assignmentId:`assignment-1${suffix}`};
 const empty=createLearningProgress({...identity,skillId:'primary',resourceIds:['r1'],requiredExerciseIds:['x1'],dataMode:'synthetic',now:1001000});
 const prediction=await createPrediction({...identity,predictionId:`prediction-1${suffix}`,progress:empty,sourceReportInput:source,sourceAnswerId:`answer-source${suffix}`,
  issuedAt:1001000,validUntil:1001000+7*86400000,predictedTargetScore:0.6,predictorVersion:'predictor-v0',target:{difficulty:2,rubric:source.turns[0]!.input.rubric}});
 const progress=recordLearningEvent(empty,{...identity,expectedVersion:0,now:1002000,event:{id:'verified',kind:'practice_verified',occurredAt:1002000,
  exerciseId:'x1',verification:{artifactId:`proof-1${suffix}`,verifierId:'fixture-reviewer',verifiedAt:1002000}}});
 const retestReportInput=await makeRetestReport(`retest${suffix}`,`different-q${suffix}`,1003000,roleId,userId);
 const request={...identity,prediction,progress,retestReportInput,retestAnswerId:`answer-retest${suffix}`,questionIssuedAt:1003000,answerSubmittedAt:1003005,
  now:1004000,dataMode:'synthetic',reference:{basis:'synthetic-fixture',reviewId:`review-1${suffix}`,reviewerId:'fixture-reviewer',answerId:`answer-retest${suffix}`,
  rubricId:'shared-content',rubricVersion:'1',score:0.5,reviewedAt:1003500}};
 return{request,empty,source};
}
