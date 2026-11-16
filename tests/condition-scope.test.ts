import {test,expect} from 'bun:test';
import {observationScenario} from '../experiments/verification-binding/observation-fixture.ts';
import {conditionScopeScenario as scoped} from '../experiments/verification-binding/condition-fixture.ts';
import {inspectVerificationBinding} from '../packages/interview-domain/src/verification-binding.ts';
import {evaluateTurnWithClarification} from '../apps/agent/src/orchestration/clarify-turn.ts';
import {evaluateTurn} from '../apps/agent/src/orchestration/evaluate-turn.ts';

for(const role of ['java-backend','web-frontend'] as const){
 test(`${role}: local conditions before/after results and unrelated history outside scope remain eligible`,()=>{
  for(const v of ['before','after','history','decimal']){const f=scoped(role,v);expect(inspectVerificationBinding(f.goal,f.binding,f.evidence,['unit'],f.answer).status).toBe('bound');}
 });
 test(`${role}: old experiments, explicit branches and distant conditions cannot be spliced into a result`,()=>{
  for(const v of ['old','else','separate','another','distant']){const f=scoped(role,v);expect(inspectVerificationBinding(f.goal,f.binding,f.evidence,['unit'],f.answer)).toEqual({status:'insufficient',reason:'verification-observation-context-mismatch'});}
 });
 test(`${role}: broadening the condition excerpt cannot hide a sentence boundary`,()=>{
  const f=scoped(role,'old');f.binding.observation.condition.end=f.binding.action.start;
  expect(inspectVerificationBinding(f.goal,f.binding,f.evidence,['unit'],f.answer).status).toBe('insufficient');
 });
 test(`${role}: same-sentence semantic attribution is an explicit remaining limitation`,()=>{
  const f=scoped(role,'known-limit');expect(inspectVerificationBinding(f.goal,f.binding,f.evidence,['unit'],f.answer)).toEqual({status:'bound',semanticSupport:'not_verified'});
 });
}
test('scope mismatch abstains, while a relevant incorrect local expectation retains zero',async()=>{
 const f=scoped('java-backend','old');expect((await evaluateTurnWithClarification(f.input,{evaluate:async()=>f.assessment,now:()=>f.at},{policy:{maxClarifications:0,minRemainingSeconds:45}})).status).toBe('abstained');
 expect(f.input.state.observations).toEqual([]);
 const wrong=observationScenario('java-backend','wrong-value');expect((await evaluateTurn(wrong.input,{evaluate:async()=>wrong.assessment,now:()=>wrong.at})).evaluation.normalizedScore).toBe(0);
});
