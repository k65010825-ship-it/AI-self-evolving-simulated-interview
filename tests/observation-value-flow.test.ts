import {test,expect} from 'bun:test';
import {observationScenario,observationVariants} from '../experiments/verification-binding/observation-fixture.ts';
import {inspectVerificationBinding} from '../packages/interview-domain/src/verification-binding.ts';
import {createEvaluationFixture} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {createPiEvaluator} from '../apps/agent/src/adapters/pi/evaluator.ts';
import {evaluateTurn} from '../apps/agent/src/orchestration/evaluate-turn.ts';
import {evaluateTurnWithClarification} from '../apps/agent/src/orchestration/clarify-turn.ts';
import {buildInterviewReport} from '../apps/agent/src/reporting/build-report.ts';
for(const role of ['java-backend','web-frontend'] as const)test(`${role}: typed policy preserves relevant controls and rejects styling, condition and cross-sentence probes`,()=>{
 for(const variant of observationVariants){const f=observationScenario(role,variant);
  const actual=inspectVerificationBinding(f.goal,f.binding,f.assessment.evidence,['unit'],f.input.answer.text);
  expect(actual.status==='bound').toBe(f.expectedBound);
 }
});
for(const roleId of ['java-backend','web-frontend'] as const)test(`${roleId}: actual local Pi roundtrip and report revalidate typed observation`,async()=>{
 const f=observationScenario(roleId),provider=await createEvaluationFixture(()=>({text:JSON.stringify(f.assessment)}));
 const evaluate=createPiEvaluator({cwd:process.cwd(),roleId,modelRuntime:provider.runtime,model:provider.model});
 const proposal=await evaluateTurn(f.input,{evaluate,now:()=>f.at});
 const raw={state:proposal.nextState,generatedAt:f.at+1,policyVersion:'typed-policy',skillLabels:{[f.input.question.skillId]:'synthetic'},turns:[{input:f.input,proposal,evidenceMode:'offline-fixture'}]};
 const report=await buildInterviewReport(raw);expect(report.assessments[0]!.evaluation.dimensions[0]!.verificationBinding!.observation).toEqual(f.binding.observation);
 expect(provider.stats.liveModelCalls).toBe(0);
 const forged=structuredClone(raw);forged.turns[0]!.proposal.evaluation.dimensions[0]!.verificationBinding!.observation!.metric.evidenceId='forged';
 await expect(buildInterviewReport(forged)).rejects.toThrow('VALIDATION_ERROR');
});
test('an unsupported style observation abstains without changing mastery, while a relevant wrong expectation retains zero',async()=>{
 const bad=observationScenario('java-backend','style-numeric');
 expect((await evaluateTurnWithClarification(bad.input,{evaluate:async()=>bad.assessment,now:()=>bad.at},{policy:{maxClarifications:0,minRemainingSeconds:45}})).status).toBe('abstained');
 expect(bad.input.state.observations).toEqual([]);
 const wrong=observationScenario('java-backend','wrong-value');expect((await evaluateTurn(wrong.input,{evaluate:async()=>wrong.assessment,now:()=>wrong.at})).evaluation.normalizedScore).toBe(0);
});
