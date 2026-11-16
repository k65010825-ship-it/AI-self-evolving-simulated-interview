import {test,expect} from 'bun:test';
import {groundQuotedEvaluation} from '../apps/agent/src/evaluation/quoted-spans.ts';
import {quotedFixture} from '../experiments/quoted-spans/fixture.ts';
import {inspectVerificationBinding} from '../packages/interview-domain/src/verification-binding.ts';
import {createEvaluationFixture} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {createPiEvaluator} from '../apps/agent/src/adapters/pi/evaluator.ts';
import {evaluateTurn} from '../apps/agent/src/orchestration/evaluate-turn.ts';
import {ModelRecoveryPolicySchema} from '../packages/contracts/src/model-recovery.ts';

test('an exact immediate context selects a duplicate target without changing its quoted meaning or score',()=>{
 const f=quotedFixture('web-frontend',0),wire=structuredClone(f.wire),text='😀列表组件是旧主题。'+f.text;
 wire.evidence[0]!.excerpt=text;
 expect(groundQuotedEvaluation(wire,text)).toMatchObject({ok:false,reason:'binding-quote-ambiguous',quoteIssue:{part:'target',matches:'multiple'}});
 Object.assign(wire.criterionScores[0]!.verificationBinding.target,{context:{before:'对照测量',after:'，预期'}});
 const r=groundQuotedEvaluation(wire,text);expect(r.ok).toBe(true);if(!r.ok)return;
 const a=r.output.criterionScores[0]!;expect(a.verificationBinding!.target.start).toBe(text.lastIndexOf('列表组件'));
 expect(a.score).toBe(0);expect(inspectVerificationBinding(f.input.rubric.criteria[0]!.verificationGoal,a.verificationBinding,r.output.evidence,a.evidenceIds,text).status).toBe('bound');
 expect(JSON.stringify(r.output)).not.toContain('context');
});

test('two-role real SDK uses anchors, while ambiguity details survive the repair wrapper and no evidence retry occurs',async()=>{
 for(const role of ['java-backend','web-frontend']as const)for(const anchored of [false,true]){
  const f=quotedFixture(role,0),wire=structuredClone(f.wire),target=wire.criterionScores[0]!.verificationBinding.target;
  f.input.answer.text=target.excerpt+'是旧主题。'+f.text;wire.evidence[0]!.excerpt=f.input.answer.text;
  if(anchored)Object.assign(target,{context:{before:wire.criterionScores[0]!.verificationBinding.action.excerpt,after:'，预期'}});
  const events:unknown[]=[],sdk=await createEvaluationFixture(()=>({text:JSON.stringify(wire)}));
  const work=evaluateTurn(f.input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:role,evidenceGrounding:'quoted-spans',
   recovery:ModelRecoveryPolicySchema.parse({maxModelRepairs:1}),onDiagnostic:d=>events.push(d)})});
  if(anchored){const r=await work;expect(r.evaluation.normalizedScore).toBe(0);}else{
   await expect(work).rejects.toThrow('MODEL_OUTPUT_INVALID');
   expect(events).toContainEqual({version:1,stage:'schema',outcome:'accepted',reason:'valid'});
   expect(events).toContainEqual({version:1,stage:'evidence',outcome:'rejected',reason:'binding-quote-ambiguous',quoteIssue:{part:'target',matches:'multiple'}});
  }
  expect(sdk.stats.providerCalls).toBe(1);
 }
});

test('context must be immediate, within the cited unit, nonempty and unique; it cannot fabricate a location',()=>{
 const f=quotedFixture(),wire=structuredClone(f.wire);
 Object.assign(wire.criterionScores[0]!.verificationBinding.action,{context:{before:'private-not-adjacent',after:''}});
 const absent=groundQuotedEvaluation(wire,f.text);expect(absent).toMatchObject({ok:false,reason:'binding-context-mismatch',quoteIssue:{part:'action',matches:'none'}});expect(JSON.stringify(absent)).not.toContain('private');
 Object.assign(wire.criterionScores[0]!.verificationBinding.action,{context:{before:'😀假设初值99，',after:''}});expect(groundQuotedEvaluation(wire,f.text).ok).toBe(true);
 Object.assign(wire.criterionScores[0]!.verificationBinding.action,{context:{before:'😀假设初值99，'}});expect(groundQuotedEvaluation(wire,f.text).ok).toBe(true);
 Object.assign(wire.criterionScores[0]!.verificationBinding.action,{context:{before:'x'.repeat(121)}});expect(groundQuotedEvaluation(wire,f.text)).toMatchObject({ok:false,reason:'invalid-schema'});
 Object.assign(wire.criterionScores[0]!.verificationBinding.action,{context:{before:'',after:''}});expect(groundQuotedEvaluation(wire,f.text)).toMatchObject({ok:false,reason:'invalid-schema'});
 const other=structuredClone(f.wire);other.evidence[0]!.excerpt='并发申请容量计数器，预期成功数最多1。';
 Object.assign(other.criterionScores[0]!.verificationBinding.action,{context:{before:'初值99，',after:''}});
 expect(groundQuotedEvaluation(other,'初值99，'+other.evidence[0]!.excerpt)).toMatchObject({ok:false,reason:'binding-context-mismatch'});
});

test('outer evidence context can disambiguate repeated sentences but repeated anchored matches still reject',()=>{
 const f=quotedFixture(),wire=structuredClone(f.wire),text='旧：'+f.text+'新：'+f.text;
 Object.assign(wire.evidence[0]!,{context:{before:'新：',after:''}});const r=groundQuotedEvaluation(wire,text);expect(r.ok).toBe(true);if(r.ok)expect(r.output.evidence[0]!.start).toBe(text.lastIndexOf(f.text));
 expect(groundQuotedEvaluation(wire,'新：'+f.text+'新：'+f.text)).toMatchObject({ok:false,reason:'evidence-quote-ambiguous',quoteIssue:{part:'evidence',matches:'multiple'}});
});
