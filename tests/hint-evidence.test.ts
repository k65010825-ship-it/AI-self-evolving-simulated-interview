import {test,expect} from 'bun:test';import {createPairFixture} from '../experiments/learning/pair-fixture.ts';
import {createPrediction,pairRetest} from '../apps/agent/src/learning/retest-pair.ts';
import {estimateSkills} from '../apps/agent/src/planning/interview-state.ts';
import {evaluateTurn} from '../apps/agent/src/orchestration/evaluate-turn.ts';
import {buildInterviewReport} from '../apps/agent/src/reporting/build-report.ts';
import {createReflectionFixture} from '../experiments/reflection/session-fixture.ts';import {reflectSession} from '../apps/agent/src/reflection/reflect-session.ts';
import {createMemory,appendMemory,startSessionFromMemory} from '../apps/agent/src/memory/session-memory.ts';
import {recallMemory} from '../apps/agent/src/memory/recall.ts';
const assistance={kind:'hint-assisted' as const,issueId:'a'.repeat(64),hintVersion:'coaching-v1' as const,receiptIds:['hint-1']};
for(const roleId of ['java-backend','web-frontend'] as const)test(`${roleId}: assisted answers retain practice scores but cannot seed forecasts, calibration or RSI`,async()=>{
 const f=await createPairFixture(roleId),original=f.request.retestReportInput.turns[0]!,input={...original.input,assistance};
 const proposal=await evaluateTurn(input,{now:()=>1003005,evaluate:async()=>({evidence:original.proposal.evidence,
  criterionScores:original.proposal.evaluation.dimensions.map(d=>({criterionId:d.criterionId,score:d.score,evidenceIds:d.evidenceIds})),feedback:original.proposal.feedback})});
 expect(proposal.nextState.observations[0]?.assistance).toEqual(assistance);
 const reportInput={...f.request.retestReportInput,state:proposal.nextState,turns:[{input,proposal,evidenceMode:'offline-fixture' as const}]};
 const report=await buildInterviewReport(reportInput);expect(report.assessments[0]?.assistance).toEqual(assistance);
 expect(estimateSkills(proposal.nextState,1003010)[0]?.independentQuestions).toBe(0);
 const identity={userId:f.request.userId,roleId};
 const memory=await appendMemory(createMemory(identity,1000000),{...identity,sessionStatus:'completed',expectedVersion:0,reportInput,now:1004000});
 const next=startSessionFromMemory(memory,{...identity,now:1005000,session:{sessionId:'next-session',roleId,durationMinutes:20,skills:proposal.nextState.skills}});
 expect(next.priorEvidence[0]?.assistance).toEqual(assistance);expect(estimateSkills(next,1005000)[0]?.independentQuestions).toBe(0);
 const recall=recallMemory(memory,{...identity,now:1005000,skillIds:['primary']});
 expect(recall.selected).toEqual([]);expect(recall.askedQuestionIds).toContain(input.question.id);expect(recall.excluded[0]?.reason).toBe('assisted_evidence');
 expect((await pairRetest({...f.request,retestReportInput:reportInput})).reasons).toContain('assisted_answer');
 await expect(createPrediction({userId:f.request.userId,roleId,assignmentId:f.request.assignmentId,predictionId:'p',progress:f.empty,sourceReportInput:reportInput,
  sourceAnswerId:input.answer.id,issuedAt:1004000,validUntil:1005000,predictedTargetScore:.5,predictorVersion:'v',target:f.request.prediction.target})).rejects.toThrow('VALIDATION_ERROR');
 const reflection=await createReflectionFixture(roleId);reflection.reportInput.turns[0]!.input={...reflection.reportInput.turns[0]!.input,assistance} as typeof reflection.reportInput.turns[0]['input'];
 // Rebuild all dependent states/plans through the real evaluator, rather than editing a report score.
 let state=reflection.reportInput.turns[0]!.input.state;
 for(const [i,t]of reflection.reportInput.turns.entries()){
  t.input={...t.input,state,expectedVersion:state.version,...(i===0?{assistance}:{})} as typeof t.input;
  t.proposal=await evaluateTurn(t.input,{now:()=>1000000+i*1000,evaluate:async()=>({evidence:t.proposal.evidence,
   criterionScores:t.proposal.evaluation.dimensions.map(d=>({criterionId:d.criterionId,score:d.score,evidenceIds:d.evidenceIds})),feedback:t.proposal.feedback})});state=t.proposal.nextState;
 }
 reflection.reportInput.state=state;expect((await reflectSession(reflection)).candidate).toBeNull();
});
