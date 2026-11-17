import {test,expect} from 'bun:test';import {createPairFixture} from '../experiments/learning/pair-fixture.ts';
import {createPrediction,pairRetest,summarizeCalibration} from '../apps/agent/src/learning/retest-pair.ts';import {planRetestQuestion} from '../apps/agent/src/learning/plan-retest.ts';
import {evaluateTurnWithClarification} from '../apps/agent/src/orchestration/clarify-turn.ts';import {buildInterviewReport} from '../apps/agent/src/reporting/build-report.ts';
import {PredictionSchema} from '../packages/contracts/src/learning.ts';
for(const roleId of ['java-backend','web-frontend'] as const)test(`${roleId}: unscored source exposure excludes a question from both planning and outcome pairing`,async()=>{
 const f=await createPairFixture(roleId),r=f.request,target=r.retestReportInput.turns[0]!.input.question;
 expect((await pairRetest(r)).status).toBe('eligible');
 const original=structuredClone(f.source.turns[0]!.input),input={...original,state:f.source.state,expectedVersion:f.source.state.version,observationId:'gap',
  question:{...original.question,id:target.id},answer:{id:'gap-answer',text:'不知道'},context:{...original.context,runId:'gap-run'},
  planningPolicy:{id:f.source.policyVersion,roleId,parameters:{maxFollowupDepth:2,maxTurns:12,wrapUpSeconds:30}}};
 const resolution=await evaluateTurnWithClarification(input,{now:()=>1000030,evaluate:async()=>{throw Error('no model expected');}});
 if(resolution.status==='scored')throw Error('expected evidence gap');
 const source={...f.source,generatedAt:1000040,unscoredTurns:[{input,resolution,evidenceMode:'offline-fixture' as const}]};
 const before=JSON.stringify(source),sourceReport=await buildInterviewReport(source);
 expect(sourceReport.coverage).toMatchObject({totalAnswers:2,scoredAnswers:1,unscoredAnswers:1});expect(source.state.observations).toHaveLength(1);
 const prediction=await createPrediction({userId:r.userId,roleId,assignmentId:r.assignmentId,predictionId:'complete-exposure',progress:f.empty,sourceReportInput:source,
  sourceAnswerId:r.prediction.sourceAnswerId,issuedAt:r.prediction.issuedAt,validUntil:r.prediction.validUntil,predictedTargetScore:r.prediction.predictedTargetScore,predictorVersion:r.prediction.predictorVersion,target:r.prediction.target});
 expect(prediction.sourceQuestionIds).toContain(target.id);
 const candidate={question:target,rubric:r.prediction.target.rubric,source:{knowledgeId:target.id,version:'fixture',sourceIds:['synthetic'],reviewStatus:'draft'}};
 const plan=planRetestQuestion({userId:r.userId,roleId,assignmentId:r.assignmentId,prediction,progress:r.progress,state:r.retestReportInput.turns[0]!.input.state,
  now:r.questionIssuedAt,askedQuestionIds:[],allowDraftKnowledge:true,candidates:[candidate]});
 expect(plan).toMatchObject({status:'unavailable',reason:'no_matching_unseen_question'});expect(plan.excluded).toContainEqual({questionId:target.id,reason:'question_repeated'});
 const pair=await pairRetest({...r,prediction});expect(pair).toMatchObject({status:'ineligible',referenceScore:null,absoluteError:null});expect(pair.reasons).toContain('question_repeated');
 expect(JSON.stringify(source)).toBe(before);expect(r.prediction.sourceQuestionIds).not.toContain(target.id);
});
test('frozen metadata can retain the full public report exposure bound without truncation',async()=>{
 const {request:r}=await createPairFixture();
 // ReportInput permits 4000 prior, 200 scored and 200 unscored question references.
 const maximum=4000+200+200,ids=Array.from({length:maximum},(_,i)=>'exposed-'+i);
 expect(PredictionSchema.safeParse({...r.prediction,sourceQuestionIds:ids}).success).toBe(true);
 expect(PredictionSchema.safeParse({...r.prediction,sourceQuestionIds:[...ids,'too-many']}).success).toBe(false);
});
for(const roleId of ['java-backend','web-frontend'] as const)test(`${roleId}: synthetic pairs and relabeled task metadata cannot become real-student calibration`,async()=>{
 const {request:r}=await createPairFixture(roleId),pair=await pairRetest(r);
 const real=summarizeCalibration({roleId,skillId:r.prediction.skillId,dataMode:'consented',predictorVersion:r.prediction.predictorVersion,targetDifficulty:r.prediction.target.difficulty,targetRubric:r.prediction.target.rubric,pairs:[pair]});
 expect(real).toMatchObject({status:'insufficient_data',eligiblePairs:0,excludedPairs:1,distinctStudents:0,mae:null});
 const promoted=await pairRetest({...r,dataMode:'consented',prediction:{...r.prediction,dataMode:'consented'},progress:{...r.progress,dataMode:'consented'},reference:{...r.reference,basis:'human-reviewed'}});
 expect(promoted).toMatchObject({status:'ineligible',referenceScore:null,absoluteError:null});expect(promoted.reasons).toContain('model_source_unverified');
});
