import{test,expect}from'bun:test';
import{createLearningProgress,recordLearningEvent}from'../apps/agent/src/learning/progress.ts';
import{createPrediction,pairRetest,summarizeCalibration}from'../apps/agent/src/learning/retest-pair.ts';
import{makeRetestReport}from'../experiments/learning/retest-fixture.ts';
import{createPairFixture}from'../experiments/learning/pair-fixture.ts';
import{evaluateTurn}from'../apps/agent/src/orchestration/evaluate-turn.ts';
import type{PerformancePair}from'../packages/contracts/src/learning.ts';
export async function pairFixture(roleId:'java-backend'|'web-frontend'='java-backend'){
 const source=await makeRetestReport('source','source-q',1000000,roleId),identity={userId:'student-1',roleId,assignmentId:'assignment-1'};
 const empty=createLearningProgress({...identity,skillId:'primary',resourceIds:['r1'],requiredExerciseIds:['x1'],dataMode:'synthetic',now:1001000});
 const prediction=await createPrediction({...identity,predictionId:'prediction-1',progress:empty,sourceReportInput:source,sourceAnswerId:'answer-source',
  issuedAt:1001000,validUntil:1001000+7*86400000,predictedTargetScore:0.6,predictorVersion:'predictor-v0',
  target:{difficulty:2,rubric:source.turns[0]!.input.rubric}});
 const progress=recordLearningEvent(empty,{...identity,expectedVersion:0,now:1002000,event:{id:'verified',kind:'practice_verified',occurredAt:1002000,
  exerciseId:'x1',verification:{artifactId:'proof-1',verifierId:'fixture-reviewer',verifiedAt:1002000}}});
 const retestReportInput=await makeRetestReport('retest','different-q',1003000,roleId);
 const request={...identity,prediction,progress,retestReportInput,retestAnswerId:'answer-retest',questionIssuedAt:1003000,answerSubmittedAt:1003005,
  now:1004000,dataMode:'synthetic',reference:{basis:'synthetic-fixture',reviewId:'review-1',reviewerId:'fixture-reviewer',answerId:'answer-retest',
   rubricId:'shared-content',rubricVersion:'1',score:0.5,reviewedAt:1003500}};
 return{request,empty,source};
}
test('freezes an explicit forecast before learning and pairs only a verified different-question retest',async()=>{
 const f=await pairFixture();const pair=await pairRetest(f.request);
 expect(pair.status).toBe('eligible');expect(pair.absoluteError).toBeCloseTo(0.1);expect(pair.predictedTargetScore).toBe(0.6);
 expect(pair.dataMode).toBe('synthetic');expect(f.request.prediction.sourceModelScore).toBe(0.5);
});
test('click/self-report are not verified exposure, and prior retest exposure or expiry stays ineligible',async()=>{
 const f=await pairFixture();
 const empty=await pairRetest({...f.request,progress:f.empty});expect(empty.status).toBe('ineligible');expect(empty.reasons).toContain('learning_not_verified');
 const lateRequest=structuredClone(f.request);lateRequest.prediction.issuedAt=lateRequest.questionIssuedAt;
 const late=await pairRetest(lateRequest);expect(late.reasons).toContain('prediction_after_retest_exposure');
 const expired=structuredClone(f.request);expired.prediction.validUntil=1002500;
 expect((await pairRetest(expired)).reasons).toContain('prediction_expired');
});
test('wrong question, difficulty or rubric does not become a calibration pair',async()=>{
 const f=await pairFixture();
 const repeated=await makeRetestReport('retest','source-q',1003000);
 expect((await pairRetest({...f.request,retestReportInput:repeated})).reasons).toContain('question_repeated');
 const difficulty=structuredClone(f.request);difficulty.prediction.target.difficulty=3;
 expect((await pairRetest(difficulty)).reasons).toContain('difficulty_mismatch');
 const rubric=structuredClone(f.request);rubric.prediction.target.rubric.version='2';
 expect((await pairRetest(rubric)).reasons).toContain('rubric_mismatch');
});
test('cross-user access, forged report and missing or mismatched reference cannot bypass validation',async()=>{
 const f=await pairFixture();
 await expect(pairRetest({...f.request,userId:'other'})).rejects.toThrow('FORBIDDEN');
 const bad=structuredClone(f.request);bad.retestReportInput.turns[0]!.proposal.evaluation.normalizedScore=1;
 await expect(pairRetest(bad)).rejects.toThrow('VALIDATION_ERROR');
 const ref=structuredClone(f.request);ref.reference.answerId='other';
 expect((await pairRetest(ref)).reasons).toContain('reference_mismatch');
});
test('too few eligible pairs leave MAE null, never zero',async()=>{
 const f=await pairFixture();const pair=await pairRetest(f.request);
 const summary=summarizeCalibration({roleId:'java-backend',skillId:'primary',dataMode:'synthetic',predictorVersion:'predictor-v0',targetDifficulty:2,
  targetRubric:f.request.prediction.target.rubric,pairs:[pair]});
 expect(summary.status).toBe('insufficient_data');expect(summary.mae).toBeNull();expect(summary.eligiblePairs).toBe(1);
});
test('a question already practiced inside the retest session is not an independent retest',async()=>{
 const f=await pairFixture();const first=f.request.retestReportInput.turns[0]!;
 const input=structuredClone(first.input);input.state=first.proposal.nextState;input.expectedVersion=1;input.observationId='repeat';input.answer.id='answer-repeat';
 const proposal=await evaluateTurn(input,{now:()=>1003020,evaluate:async()=>({evidence:first.proposal.evidence,
  criterionScores:[{criterionId:'correctness',score:2,evidenceIds:['e']}],feedback:first.proposal.feedback})});
 const report={...f.request.retestReportInput,state:proposal.nextState,generatedAt:1003030,
  turns:[first,{input,proposal,evidenceMode:'offline-fixture'}]};
 const pair=await pairRetest({...f.request,retestReportInput:report,retestAnswerId:'answer-repeat',questionIssuedAt:1003015,answerSubmittedAt:1003018,
  reference:{...f.request.reference,answerId:'answer-repeat'}});
 expect(pair.reasons).toContain('question_repeated');
});
test('calibration cohorts cannot mix skills sharing the same generic rubric',async()=>{
 const pairs=[];let targetRubric;
 for(let i=0;i<8;i++){const f=await createPairFixture('java-backend',`student-${i%2}`,`-${i}`);targetRubric=f.request.prediction.target.rubric;
  const pair=await pairRetest(f.request);if(i>=4)pair.skillId='secondary';pairs.push(pair);}
 const summary=summarizeCalibration({roleId:'java-backend',skillId:'primary',dataMode:'synthetic',predictorVersion:'predictor-v0',targetDifficulty:2,targetRubric,pairs});
 expect(summary.eligiblePairs).toBe(4);expect(summary.status).toBe('insufficient_data');expect(summary.mae).toBeNull();
});
test('late-recorded pre-prediction clicks are still prior learning exposure',async()=>{
 const f=await pairFixture();const identity={userId:'student-1',roleId:'java-backend',assignmentId:'assignment-1'};
 const empty=createLearningProgress({...identity,skillId:'primary',resourceIds:['r1'],requiredExerciseIds:['x1'],dataMode:'synthetic',now:1000500});
 const prediction=await createPrediction({...identity,predictionId:'prediction-1',progress:empty,sourceReportInput:f.source,sourceAnswerId:'answer-source',
  issuedAt:1001000,validUntil:1001000+7*86400000,predictedTargetScore:0.6,predictorVersion:'predictor-v0',target:f.request.prediction.target});
 let progress=recordLearningEvent(empty,{...identity,expectedVersion:0,now:1002000,event:f.request.progress.events[0]!.event});
 progress=recordLearningEvent(progress,{...identity,expectedVersion:1,now:1002100,event:{id:'late-click',kind:'resource_clicked',occurredAt:1000600,resourceId:'r1'}});
 expect((await pairRetest({...f.request,prediction,progress})).reasons).toContain('learning_outside_window');
});
test('eight independent synthetic pairs from two students yield only a labeled descriptive MAE',async()=>{
 const pairs:PerformancePair[]=[];let targetRubric;
 for(let i=0;i<8;i++){const f=await createPairFixture('java-backend',`student-${i%2}`,`-ready-${i}`);targetRubric=f.request.prediction.target.rubric;pairs.push(await pairRetest(f.request));}
 const cohort={roleId:'java-backend',skillId:'primary',dataMode:'synthetic',predictorVersion:'predictor-v0',targetDifficulty:2,targetRubric,pairs};
 const summary=summarizeCalibration(cohort);expect(summary.status).toBe('ready');expect(summary.mae).toBeCloseTo(0.1);
 expect(summary.distinctStudents).toBe(2);expect(summary.dataMode).toBe('synthetic');
 const changed=structuredClone(cohort);changed.pairs[0]!.predictorVersion='other';
 expect(summarizeCalibration(changed).eligiblePairs).toBe(7);expect(summarizeCalibration(changed).mae).toBeNull();
 expect(()=>summarizeCalibration({...cohort,pairs:[pairs[0],pairs[0]]})).toThrow('VALIDATION_ERROR');
 const duplicate=structuredClone(pairs[0]!);duplicate.predictionId='other-prediction';duplicate.retestAnswerId='other-answer';duplicate.retestQuestionId='other-question';
 expect(()=>summarizeCalibration({...cohort,pairs:[pairs[0],duplicate]})).toThrow('VALIDATION_ERROR');
});
