import{CreatePredictionSchema,PredictionSchema,PairRetestSchema,PerformancePairSchema,CalibrationInputSchema,CalibrationSummarySchema,
 type Prediction,type PerformancePair,type CalibrationSummary}from'../../../../packages/contracts/src/learning.ts';
import{buildInterviewReport}from'../reporting/build-report.ts';
import{AgentStateError}from'../planning/interview-state.ts';
import{parseLearning,authorizeLearning,summarizeLearning}from'./progress.ts';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export async function createPrediction(rawInput:unknown):Promise<Prediction>{
 const input=parseLearning(CreatePredictionSchema,rawInput);authorizeLearning(input.progress,input);
 if(input.progress.events.length||input.progress.createdAt>input.issuedAt||input.sourceReportInput.generatedAt>input.issuedAt)throw new AgentStateError('VALIDATION_ERROR');
 if(input.sourceReportInput.state.roleId!==input.roleId||input.target.rubric.roleId!==input.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
 if(input.sourceReportInput.turns.some(t=>t.input.context.userId!==input.userId))throw new AgentStateError('FORBIDDEN');
 const report=await buildInterviewReport(input.sourceReportInput),source=report.assessments.find(a=>a.answerId===input.sourceAnswerId);
 if(!source||source.assistance||source.skillId!==input.progress.skillId||source.evaluation.normalizedScore===null)throw new AgentStateError('VALIDATION_ERROR');
 return parseLearning(PredictionSchema,{kind:'frozen-learning-prediction',userId:input.userId,roleId:input.roleId,assignmentId:input.assignmentId,
  predictionId:input.predictionId,skillId:input.progress.skillId,dataMode:input.progress.dataMode,issuedAt:input.issuedAt,validUntil:input.validUntil,
  predictedTargetScore:input.predictedTargetScore,predictorVersion:input.predictorVersion,target:input.target,expectedExerciseIds:input.progress.requiredExerciseIds,
  sourceSessionId:report.sessionId,sourceAnswerId:source.answerId,sourceQuestionIds:[...new Set([
   ...input.sourceReportInput.state.priorEvidence.map(o=>o.questionId),...input.sourceReportInput.state.observations.map(o=>o.questionId),
   ...(report.unscoredAnswers??[]).map(a=>a.questionId)])],
  sourceModelScore:source.evaluation.normalizedScore,sourceEvidenceMode:report.evidenceMode});
}
export async function pairRetest(rawInput:unknown):Promise<PerformancePair>{
 const input=parseLearning(PairRetestSchema,rawInput),prediction=input.prediction;authorizeLearning(prediction,input);authorizeLearning(input.progress,input);
 if(input.progress.skillId!==prediction.skillId||!same(input.progress.requiredExerciseIds,prediction.expectedExerciseIds))throw new AgentStateError('VALIDATION_ERROR');
 if(input.retestReportInput.turns.some(t=>t.input.context.userId!==input.userId))throw new AgentStateError('FORBIDDEN');
 const report=await buildInterviewReport(input.retestReportInput),assessment=report.assessments.find(a=>a.answerId===input.retestAnswerId);
 if(!assessment)throw new AgentStateError('VALIDATION_ERROR');
 const observed=input.retestReportInput.state.observations.find(o=>o.observationId===assessment.observationId)!;
 if(input.now<input.retestReportInput.generatedAt||input.now<input.progress.updatedAt||input.questionIssuedAt>input.answerSubmittedAt
  ||input.answerSubmittedAt>observed.observedAt||input.questionIssuedAt< input.retestReportInput.state.startedAt)throw new AgentStateError('VALIDATION_ERROR');
 const reasons:PerformancePair['reasons']=[],learning=summarizeLearning(input.progress,{userId:input.userId,roleId:input.roleId,assignmentId:input.assignmentId});
 if(learning.status!=='verified_complete')reasons.push('learning_not_verified');
 const proofTimes=input.progress.events.filter(e=>e.event.kind==='practice_verified').map(e=>e.event.kind==='practice_verified'?e.event.verification.verifiedAt:0);
 if(input.progress.events.some(e=>e.event.occurredAt<prediction.issuedAt)||proofTimes.some(t=>t<prediction.issuedAt)
  ||learning.verifiedCompleteAt!==null&&learning.verifiedCompleteAt>=input.questionIssuedAt)reasons.push('learning_outside_window');
 if(prediction.issuedAt>=input.questionIssuedAt)reasons.push('prediction_after_retest_exposure');
 if(input.answerSubmittedAt>prediction.validUntil)reasons.push('prediction_expired');
 const retestInput=input.retestReportInput.turns.find(t=>t.input.answer.id===assessment.answerId)!.input;
 if(assessment.assistance)reasons.push('assisted_answer');
 if(prediction.sourceQuestionIds.includes(assessment.questionId)||[...retestInput.state.priorEvidence,...retestInput.state.observations]
  .some(o=>o.questionId===assessment.questionId))reasons.push('question_repeated');
 if(prediction.sourceSessionId===report.sessionId)reasons.push('session_reused');
 if(prediction.roleId!==report.roleId)reasons.push('role_mismatch');if(prediction.skillId!==assessment.skillId)reasons.push('skill_mismatch');
 if(prediction.target.difficulty!==assessment.difficulty)reasons.push('difficulty_mismatch');
 if(!same(prediction.target.rubric,assessment.rubric))reasons.push('rubric_mismatch');
 if(input.dataMode!==prediction.dataMode||input.progress.dataMode!==prediction.dataMode)reasons.push('data_mode_mismatch');
 if(prediction.dataMode==='unverified')reasons.push('unverified_data_mode');
 if(prediction.dataMode==='consented'&&(prediction.sourceEvidenceMode!=='live-model'||report.evidenceMode!=='live-model'))reasons.push('model_source_unverified');
 const reference=input.reference;
 if(!reference)reasons.push('reference_missing');else{
  if(reference.answerId!==assessment.answerId||reference.rubricId!==assessment.rubricId||reference.rubricVersion!==assessment.rubricVersion
   ||reference.reviewedAt<input.answerSubmittedAt||reference.reviewedAt>input.now)reasons.push('reference_mismatch');
  if(reference.basis!==(prediction.dataMode==='synthetic'?'synthetic-fixture':'human-reviewed'))reasons.push('reference_unverified');
 }
 const eligible=reasons.length===0;
 return parseLearning(PerformancePairSchema,{kind:'uncommitted-performance-pair',userId:prediction.userId,roleId:prediction.roleId,assignmentId:prediction.assignmentId,
  predictionId:prediction.predictionId,skillId:prediction.skillId,status:eligible?'eligible':'ineligible',reasons:[...new Set(reasons)],dataMode:prediction.dataMode,
  predictorVersion:prediction.predictorVersion,target:prediction.target,sourceSessionId:prediction.sourceSessionId,retestSessionId:report.sessionId,
  retestAnswerId:assessment.answerId,retestQuestionId:assessment.questionId,predictedTargetScore:prediction.predictedTargetScore,
  referenceScore:eligible?reference!.score:null,referenceReviewId:reference?.reviewId??null,
  absoluteError:eligible?Math.abs(prediction.predictedTargetScore-reference!.score):null});
}
export function summarizeCalibration(rawInput:unknown):CalibrationSummary{
 const input=parseLearning(CalibrationInputSchema,rawInput);
 if(input.targetRubric.roleId!==input.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
 if(new Set(input.pairs.map(p=>p.predictionId)).size!==input.pairs.length||new Set(input.pairs.map(p=>JSON.stringify([p.userId,p.retestSessionId,p.retestAnswerId]))).size!==input.pairs.length)
  throw new AgentStateError('VALIDATION_ERROR');
 const eligible=input.pairs.filter(p=>p.status==='eligible'&&p.roleId===input.roleId&&p.skillId===input.skillId&&p.dataMode===input.dataMode&&p.predictorVersion===input.predictorVersion
  &&p.target.difficulty===input.targetDifficulty&&same(p.target.rubric,input.targetRubric));
 if(new Set(eligible.map(p=>JSON.stringify([p.userId,p.retestQuestionId]))).size!==eligible.length)throw new AgentStateError('VALIDATION_ERROR');
 if(new Set(eligible.map(p=>JSON.stringify([p.userId,p.assignmentId]))).size!==eligible.length)throw new AgentStateError('VALIDATION_ERROR');
 const distinctStudents=new Set(eligible.map(p=>p.userId)).size,ready=input.dataMode!=='unverified'&&eligible.length>=8&&distinctStudents>=2;
 return CalibrationSummarySchema.parse({kind:'descriptive-calibration-summary',roleId:input.roleId,skillId:input.skillId,dataMode:input.dataMode,predictorVersion:input.predictorVersion,
  targetDifficulty:input.targetDifficulty,targetRubricId:input.targetRubric.id,targetRubricVersion:input.targetRubric.version,
  status:ready?'ready':'insufficient_data',eligiblePairs:eligible.length,excludedPairs:input.pairs.length-eligible.length,distinctStudents,
  minimumPairs:8,minimumStudents:2,mae:ready?eligible.reduce((sum,p)=>sum+Math.abs(p.predictedTargetScore-p.referenceScore!),0)/eligible.length:null});
}
