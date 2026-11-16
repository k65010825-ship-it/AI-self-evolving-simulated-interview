import {TurnInputSchema} from '../packages/contracts/src/evaluation.ts';
import {test,expect} from 'bun:test';
import {verificationScenario} from '../experiments/verification-binding/fixture.ts';
import {createEvaluationFixture} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {createPiEvaluator} from '../apps/agent/src/adapters/pi/evaluator.ts';
import {evaluateTurn} from '../apps/agent/src/orchestration/evaluate-turn.ts';
import {evaluateTurnWithClarification} from '../apps/agent/src/orchestration/clarify-turn.ts';
import {buildInterviewReport} from '../apps/agent/src/reporting/build-report.ts';
import {validateWorkflowTransition} from '../packages/agent-client/src/commit-validation.ts';
import {finishCommitFixture} from './helpers/finish-commit-fixture.ts';
for(const roleId of ['java-backend','web-frontend'] as const)test(`structured verification ${roleId}: actual Pi output survives grading and report replay`,async()=>{
 const f=verificationScenario(roleId),provider=await createEvaluationFixture(()=>({text:JSON.stringify(f.assessment)}));
 const evaluate=createPiEvaluator({cwd:process.cwd(),roleId,modelRuntime:provider.runtime,model:provider.model});
 const proposal=await evaluateTurn(f.input,{evaluate,now:()=>f.at});
 const reportInput={state:proposal.nextState,generatedAt:f.at+1,policyVersion:'synthetic-policy',skillLabels:{[f.input.question.skillId]:'synthetic'},turns:[{input:f.input,proposal,evidenceMode:'offline-fixture'}]};
 const report=await buildInterviewReport(reportInput);
 expect(report.assessments[0]?.evaluation.dimensions[0]?.verificationBinding).toEqual(f.assessment.criterionScores[0]?.verificationBinding);
 expect(report.assessments[0]?.criterionFeedback?.[0]?.semanticSupport).toBe('not_verified');expect(provider.stats.liveModelCalls).toBe(0);
 const forged=structuredClone(reportInput);forged.turns[0]!.proposal.evaluation.dimensions[0]!.verificationBinding!.goalVersion='stale';
 await expect(buildInterviewReport(forged)).rejects.toThrow('VALIDATION_ERROR');
});
test('a missing extraction chain causes no mastery observation and cannot silently become zero',async()=>{
 const f=verificationScenario(),assessment=structuredClone(f.assessment);delete (assessment.criterionScores[0] as {verificationBinding?:unknown}).verificationBinding;
 const result=await evaluateTurnWithClarification(f.input,{evaluate:async()=>assessment,now:()=>f.at},{policy:{maxClarifications:0,minRemainingSeconds:45}});
 expect(result.status).toBe('abstained');expect(f.input.state.observations).toEqual([]);
});
test('candidate restore revalidates the same host goal and proof',async()=>{
 const f=verificationScenario(),proposal=await evaluateTurn(f.input,{evaluate:async()=>f.assessment,now:()=>f.at}),base=await finishCommitFixture();
 try{
  const snapshot=structuredClone(base.store.current().session!.workflow);
  snapshot.turns=[{input:TurnInputSchema.parse(f.input),proposal,evidenceMode:'offline-fixture'}];
  snapshot.state=proposal.nextState;
  expect(()=>validateWorkflowTransition({action:'restore',snapshot},snapshot,Date.now())).not.toThrow();
  snapshot.turns[0]!.proposal.evaluation.dimensions[0]!.verificationBinding!.target={evidenceId:'unit',start:0,end:2};
  expect(()=>validateWorkflowTransition({action:'restore',snapshot},snapshot,Date.now())).toThrow('COMMIT_TRANSITION_INVALID');
 }finally{base.runtime.dispose();}
});
