import {test,expect} from 'bun:test';
import {groundQuotedEvaluation} from '../apps/agent/src/evaluation/quoted-spans.ts';
import {quotedFixture} from '../experiments/quoted-spans/fixture.ts';
import {inspectVerificationBinding} from '../packages/interview-domain/src/verification-binding.ts';
import {createPiEvaluator} from '../apps/agent/src/adapters/pi/evaluator.ts';
import {createEvaluationFixture} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {evaluateTurn} from '../apps/agent/src/orchestration/evaluate-turn.ts';
import {evaluateTurnWithClarification} from '../apps/agent/src/orchestration/clarify-turn.ts';

test('host grounds all verification excerpts and observation parts without guessing Unicode offsets or changing scores',()=>{
 for(const role of ['java-backend','web-frontend'] as const)for(const score of [0,3]){
  const f=quotedFixture(role,score),before=structuredClone(f.wire),r=groundQuotedEvaluation(f.wire,f.text);expect(r.ok).toBe(true);if(!r.ok)continue;
  const a=r.output.criterionScores[0]!,b=a.verificationBinding!;
  expect(f.text.slice(b.action.start,b.action.end)).toBe(before.criterionScores[0]!.verificationBinding.action.excerpt);
  expect(inspectVerificationBinding(f.input.rubric.criteria[0]!.verificationGoal,b,r.output.evidence,a.evidenceIds,f.text).status).toBe('bound');
  expect(a.score).toBe(score);expect(f.wire).toEqual(before);
 }
});

test('quote protocol rejects absent, ambiguous, uncited, mixed-coordinate and forged fields',()=>{
 const f=quotedFixture();
 const a=structuredClone(f.wire);a.criterionScores[0]!.verificationBinding.action.excerpt='private-absent';expect(groundQuotedEvaluation(a,f.text)).toMatchObject({ok:false,reason:'binding-quote-absent'});
 const b=structuredClone(f.wire);b.evidence[0]!.excerpt=f.text+f.text;expect(groundQuotedEvaluation(b,f.text+f.text)).toMatchObject({ok:false,reason:'binding-quote-ambiguous'});
 const c=structuredClone(f.wire);c.criterionScores[0]!.evidenceIds=[];expect(groundQuotedEvaluation(c,f.text)).toMatchObject({ok:false,reason:'binding-unit-uncited'});
 const d=structuredClone(f.wire);Object.assign(d.criterionScores[0]!.verificationBinding.action,{start:0,end:1});expect(groundQuotedEvaluation(d,f.text)).toMatchObject({ok:false,reason:'invalid-schema'});
 const e=structuredClone(f.wire);Object.assign(e,{privateField:'private-secret'});const failure=groundQuotedEvaluation(e,f.text);expect(failure).toMatchObject({ok:false,reason:'invalid-schema'});expect(JSON.stringify(failure)).not.toContain('private');
 const cross=structuredClone(f.wire);cross.criterionScores[0]!.verificationBinding.target.evidenceId='other';expect(groundQuotedEvaluation(cross,f.text)).toMatchObject({ok:false,reason:'binding-unit-mismatch'});
 const changed=structuredClone(f.wire);changed.criterionScores[0]!.verificationBinding.target.excerpt='容量计數器';expect(groundQuotedEvaluation(changed,f.text)).toMatchObject({ok:false,reason:'binding-quote-absent'});
 const mixed=structuredClone(f.wire);Object.assign(mixed.evidence[0]!,{start:0,end:1});expect(groundQuotedEvaluation(mixed,f.text)).toMatchObject({ok:false,reason:'invalid-schema'});
 const repeated=structuredClone(f.wire);repeated.evidence[0]!.excerpt='哈哈哈'+f.text;repeated.criterionScores[0]!.verificationBinding.action.excerpt='哈哈';expect(groundQuotedEvaluation(repeated,'哈哈哈'+f.text)).toMatchObject({ok:false,reason:'binding-quote-ambiguous'});
});

test('quote-mode domain rejections reach orchestration as static categories, not only invalid-score',async()=>{
 for(const dimensionMissing of [false,true]){const f=quotedFixture(),events:unknown[]=[];
  const wire={...f.wire,criterionScores:dimensionMissing?[]:[{...f.wire.criterionScores[0]!,score:99}]};
  const sdk=await createEvaluationFixture(()=>({text:JSON.stringify(wire)}));
  await expect(evaluateTurnWithClarification(f.input,{onDiagnostic:d=>events.push(d),evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',evidenceGrounding:'quoted-spans'})})).rejects.toThrow('MODEL_OUTPUT_INVALID');
  expect(events).toContainEqual({version:1,stage:'scoring',outcome:'rejected',reason:dimensionMissing?'score-dimension-set-mismatch':'score-out-of-range'});expect(sdk.stats.providerCalls).toBe(1);
 }
});

test('two-role quoted SDK continuation retains original answer and creates exactly one scored observation',async()=>{
 for(const role of ['java-backend','web-frontend']as const){const f=quotedFixture(role),original='我会先考虑验证边界，具体条件还未给出。';
  const firstInput={...f.input,answer:{...f.input.answer,text:original}};
  let calls=0;const sdk=await createEvaluationFixture(()=>({text:JSON.stringify(++calls===1?
   {evidence:[],criterionScores:[{criterionId:'verification',score:null,evidenceIds:[]}],feedback:{strengths:[],improvements:['请补充验证条件和观察']}}:f.wire)}));
  const evaluate=createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:role,evidenceGrounding:'quoted-spans'});
  const first=await evaluateTurnWithClarification(firstInput,{evaluate});expect(first.status).toBe('needs_clarification');if(first.status!=='needs_clarification')throw Error('expected clarification');
  const next={...firstInput,context:{...firstInput.context,runId:firstInput.context.runId+'-supplement',attemptId:'two'},answer:{id:'supplement',text:original+'\n'+f.text}};
  const scored=await evaluateTurnWithClarification(next,{evaluate},{previous:first});expect(scored.status).toBe('scored');
  if(scored.status==='scored'){expect(scored.proposal.nextState.observations).toHaveLength(1);expect(scored.proposal.evaluation.normalizedScore).toBe(.75);}
  expect(sdk.stats.providerCalls).toBe(2);expect(firstInput.answer.text).toBe(original);
 }
});

test('quotes resolve only inside the cited unit, not a matching fragment from another sentence',()=>{
 const f=quotedFixture(),wire=structuredClone(f.wire),text='初值99只是旧实验。'+f.text;
 const result=groundQuotedEvaluation(wire,text);expect(result.ok).toBe(true);if(!result.ok)return;
 expect(result.output.criterionScores[0]!.verificationBinding!.observation!.condition.start).toBe(text.lastIndexOf('初值99'));
 wire.evidence[0]!.excerpt=f.text.replace('初值99','未说明条件');
 expect(groundQuotedEvaluation(wire,text.replace(f.text,wire.evidence[0]!.excerpt))).toMatchObject({ok:false,reason:'binding-quote-absent'});
});

test('real Pi quote-mode evaluates both roles once; legacy mode rejects quote wire and semantic guards still reject overlapping spans',async()=>{
 for(const role of ['java-backend','web-frontend']as const){const f=quotedFixture(role,0),events:unknown[]=[],sdk=await createEvaluationFixture(()=>({text:JSON.stringify(f.wire)}));
  const result=await evaluateTurn(f.input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:role,evidenceGrounding:'quoted-spans',onDiagnostic:e=>events.push(e)})});
  expect(result.evaluation.normalizedScore).toBe(0);expect(sdk.stats.providerCalls).toBe(1);expect(events).toContainEqual({version:1,stage:'evidence',outcome:'repaired',reason:'verification-quotes-grounded'});
 }
 const f=quotedFixture();for(const mode of ['model-offsets','unique-excerpt']as const){const sdk=await createEvaluationFixture(()=>({text:JSON.stringify(f.wire)}));
  await expect(evaluateTurn(f.input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',evidenceGrounding:mode})})).rejects.toThrow('MODEL_OUTPUT_INVALID');}
 const wire=structuredClone(f.wire);wire.criterionScores[0]!.verificationBinding.target=wire.criterionScores[0]!.verificationBinding.action;
 const sdk=await createEvaluationFixture(()=>({text:JSON.stringify(wire)}));
 await expect(evaluateTurn(f.input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',evidenceGrounding:'quoted-spans'})})).rejects.toThrow('MODEL_OUTPUT_INVALID');
});
