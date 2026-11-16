import {test,expect} from 'bun:test';
import {createVerificationCandidates} from '../apps/agent/src/evaluation/verification-candidates.ts';
import {groundCandidateEvaluation} from '../apps/agent/src/evaluation/candidate-evaluation.ts';
import {quotedFixture} from '../experiments/quoted-spans/fixture.ts';
import {createEvaluationFixture} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {createPiEvaluator} from '../apps/agent/src/adapters/pi/evaluator.ts';
import {evaluateTurn} from '../apps/agent/src/orchestration/evaluate-turn.ts';
import {candidateOutputSchemaForRubric} from '../apps/agent/src/harness/skills/evaluation-candidates.ts';
import {z} from 'zod';
const scope=(f:ReturnType<typeof quotedFixture>)=>({answer:f.text,question:f.input.question.text,rubric:f.input.rubric});
function selected(f:ReturnType<typeof quotedFixture>,score=0){const registry=createVerificationCandidates(scope(f)),c=registry.catalog[0]!;
 const ids=(part:'action'|'target'|'expectation'|'metric'|'value'|'condition')=>c[part]![0]!.id;
 const selection={mode:'proposed',action:ids('action'),target:ids('target'),expectation:ids('expectation'),observation:{metric:ids('metric'),value:ids('value'),condition:ids('condition')}};
 return{registry,wire:{evidence:[],criterionScores:[{criterionId:'verification',score,evidenceIds:[],verificationSelection:selection}],feedback:f.wire.feedback}};
}
test('host catalog preserves wrong values and Unicode positions; explicit selection grounds without invented quotes',()=>{
 for(const role of ['java-backend','web-frontend']as const){const f=quotedFixture(role,0),{registry,wire}=selected(f),result=groundCandidateEvaluation(wire,registry);
  expect(result.ok).toBe(true);if(!result.ok)continue;
  const score=result.output.criterionScores[0]!,b=score.verificationBinding!;expect(score.score).toBe(0);
  expect(f.text.slice(b.action.start,b.action.end)).toBe(role==='java-backend'?'并发申请':'对照测量');
  expect(f.text.slice(b.observation!.value.start,b.observation!.value.end)).toBe(role==='java-backend'?'最多100':'下降20%');
  expect(result.output.evidence[0]!.excerpt).toBe(f.text.slice(result.output.evidence[0]!.start,result.output.evidence[0]!.end));
 }
});
test('repeated source occurrences have distinct IDs, mixed procedures and negated actions remain refused',()=>{
 const f=quotedFixture(),twice={...f,text:f.text+'；'+f.text},r=createVerificationCandidates(scope(twice)),catalog=r.catalog[0]!;
 expect(catalog.action).toHaveLength(2);expect(catalog.action[0]!.id).not.toBe(catalog.action[1]!.id);
 const s=selected(twice);s.wire.criterionScores[0]!.verificationSelection.observation.condition=catalog.condition![1]!.id;
 expect(groundCandidateEvaluation(s.wire,r)).toMatchObject({ok:false,candidateIssue:'cross-sentence'});
 const negative={...f,text:f.text.replace('并发申请','没有并发申请')},n=selected(negative);
 expect(groundCandidateEvaluation(n.wire,n.registry)).toMatchObject({ok:false,candidateIssue:'binding-guard'});
 const original=selected(f);original.registry.catalog[0]!.action[0]!.excerpt='fabricated';const result=groundCandidateEvaluation(original.wire,original.registry);
 expect(result.ok).toBe(true);if(result.ok){const b=result.output.criterionScores[0]!.verificationBinding!;expect(f.text.slice(b.action.start,b.action.end)).toBe('并发申请');}
});
test('empty catalogs allow only null goal shapes, caps fail closed, raw legacy bindings are not repaired',()=>{
 const f=quotedFixture(),none=createVerificationCandidates({...scope(f),answer:'没有提供任何具体方案'}),schema=z.fromJSONSchema(candidateOutputSchemaForRubric(f.input.rubric,none.catalog));
 const feedback=f.wire.feedback;expect(schema.safeParse({evidence:[],criterionScores:[{criterionId:'verification',score:null,evidenceIds:[]}],feedback}).success).toBe(true);
 expect(schema.safeParse({evidence:[],criterionScores:[{criterionId:'verification',score:0,evidenceIds:[]}],feedback}).success).toBe(false);
 expect(()=>createVerificationCandidates({...scope(f),answer:('并发申请容量计数器，').repeat(17)})).toThrow('CONTEXT_BUDGET_EXCEEDED');
 expect(groundCandidateEvaluation(f.wire,selected(f).registry)).toMatchObject({ok:false,stage:'schema'});
});
test('real Pi receives candidate data and explicitly selected zero retains exact source evidence in both roles',async()=>{
 for(const role of ['java-backend','web-frontend']as const){const f=quotedFixture(role,0),s=selected(f);let sawData=false;
  const sdk=await createEvaluationFixture(context=>{const json=context.messages.findLast(m=>m.role==='user')!;
   const text=typeof json.content==='string'?json.content:json.content.filter(c=>c.type==='text').map(c=>c.text).join('');sawData=JSON.parse(text).verificationCandidates[0].criterionId==='verification';return{text:JSON.stringify(s.wire)};});
  const result=await evaluateTurn(f.input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:role,evidenceGrounding:'quoted-spans',verificationExtraction:'candidate-refs'})});
  expect(sawData).toBe(true);expect(result.evaluation.normalizedScore).toBe(0);expect(sdk.stats.providerCalls).toBe(1);expect(f.input.state.observations).toHaveLength(0);
 }
});
test('host predicates retain allowed metric/value overlap and aliases are literals rather than regex',()=>{
 const f=quotedFixture(),goal=f.input.rubric.criteria[0]!.verificationGoal!;
 goal.observationAliases=['超额'];goal.observationPolicy!.predicateAliases=['没有超额'];
 f.text='假设初值99，并发申请容量计数器，预期没有超额。';const p=selected(f);expect(groundCandidateEvaluation(p.wire,p.registry).ok).toBe(true);
 goal.actionAliases=['CAS(a+b)'];f.text=f.text.replace('并发申请','CAS(a+b)');const literal=selected(f);
 expect(literal.registry.catalog[0]!.action.map(x=>x.excerpt)).toEqual(['CAS(a+b)']);expect(groundCandidateEvaluation(literal.wire,literal.registry).ok).toBe(true);
});
test('candidate mode rejects incompatible config and overflow before any SDK dispatch',async()=>{
 const f=quotedFixture(),sdk=await createEvaluationFixture(()=>{throw Error('must not call');});
 expect(()=>createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',verificationExtraction:'candidate-refs'})).toThrow('VALIDATION_ERROR');
 f.input.answer.text=('并发申请容量计数器，').repeat(17);
 await expect(evaluateTurn(f.input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',evidenceGrounding:'quoted-spans',verificationExtraction:'candidate-refs'})})).rejects.toThrow('CONTEXT_BUDGET_EXCEEDED');
 expect(sdk.stats.providerCalls).toBe(0);
});
test('unsupported numeric continuations never become shorter values, while decimal points remain inside values',()=>{
 for(const value of ['最多100万','最多1,000','最多1，000']){const f=quotedFixture('java-backend',0);f.text=f.text.replace('最多100',value);
  expect(f.text).toContain(value);
  expect(createVerificationCandidates(scope(f)).catalog[0]!.value).toEqual([]);
 }
 for(const value of ['下降至少20%','下降了20%']){const f=quotedFixture('web-frontend');f.text=f.text.replace('下降20%',value);expect(f.text).toContain(value);expect(createVerificationCandidates(scope(f)).catalog[0]!.value).toEqual([]);}
 const f=quotedFixture('java-backend',0);f.text=f.text.replace('最多100','最多1.5');const s=selected(f),r=groundCandidateEvaluation(s.wire,s.registry);
 expect(r.ok).toBe(true);if(r.ok){const span=r.output.criterionScores[0]!.verificationBinding!.observation!.value;expect(f.text.slice(span.start,span.end)).toBe('最多1.5');}
});
test('procedure-only goals cannot bind across a nondecimal English sentence boundary',()=>{
 const f=quotedFixture();delete f.input.rubric.criteria[0]!.verificationGoal!.observationPolicy;
 f.text='并发申请容量计数器，记录日志.预期成功数最多1。';const registry=createVerificationCandidates(scope(f)),c=registry.catalog[0]!;
 const wire={evidence:[],criterionScores:[{criterionId:'verification',score:0,evidenceIds:[],verificationSelection:{mode:'proposed',action:c.action[0]!.id,target:c.target[0]!.id,expectation:c.expectation[0]!.id}}],feedback:f.wire.feedback};
 expect(groundCandidateEvaluation(wire,registry)).toMatchObject({ok:false,candidateIssue:'cross-sentence'});
});
test('foreign, wrong-part and missing selections reject; null never acquires automatic evidence',()=>{
 const f=quotedFixture(),{registry,wire}=selected(f),other=quotedFixture();other.text='另一次。'+other.text;const foreign=selected(other).wire;
 expect(groundCandidateEvaluation(foreign,registry).ok).toBe(false);
 const bad=structuredClone(wire);bad.criterionScores[0]!.verificationSelection.action=bad.criterionScores[0]!.verificationSelection.target;
 expect(groundCandidateEvaluation(bad,registry).ok).toBe(false);
 expect(groundCandidateEvaluation({...wire,criterionScores:[{criterionId:'verification',score:0,evidenceIds:[]}]},registry).ok).toBe(false);
 const nullWire={...wire,criterionScores:[{criterionId:'verification',score:null,evidenceIds:[]}]};
 const r=groundCandidateEvaluation(nullWire,registry);expect(r.ok).toBe(true);if(r.ok){expect(r.output.evidence).toEqual([]);expect(r.output.criterionScores[0]!.verificationBinding).toBeUndefined();}
 expect(groundCandidateEvaluation({...wire,criterionScores:[{...wire.criterionScores[0]!,score:null}]},registry).ok).toBe(false);
});
