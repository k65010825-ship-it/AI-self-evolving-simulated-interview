import {test,expect} from 'bun:test';
import {quotedFixture} from '../experiments/quoted-spans/fixture.ts';
import {groundQuotedEvaluation} from '../apps/agent/src/evaluation/quoted-spans.ts';
import {inspectVerificationBinding} from '../packages/interview-domain/src/verification-binding.ts';
import {createScoringExecutor} from '../apps/agent/src/tools/scoring-executor.ts';
import {createEvaluationFixture} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {createPiEvaluator} from '../apps/agent/src/adapters/pi/evaluator.ts';
import {evaluateTurn} from '../apps/agent/src/orchestration/evaluate-turn.ts';

test('binding refusals retain their old reason and distinguish existing structural constraints',()=>{
 const f=quotedFixture(),r=groundQuotedEvaluation(f.wire,f.text);if(!r.ok)throw Error('fixture');const b=r.output.criterionScores[0]!.verificationBinding!,goal=f.input.rubric.criteria[0]!.verificationGoal;
 const cases=[['goal-id-mismatch',{...b,goalId:'other'}],['goal-version-mismatch',{...b,goalVersion:'other'}],
 ['span-overlap',{...b,target:b.action}],['span-range-invalid',{...b,target:{...b.target,end:9999}}],
 ['observation-outside-expectation',{...b,observation:{...b.observation!,metric:b.action}}]]as const;
 for(const [detail,binding]of cases)expect(inspectVerificationBinding(goal,binding,r.output.evidence,['unit'],f.text)).toMatchObject({status:'invalid',reason:'verification-binding-invalid',detail});
 expect(inspectVerificationBinding(undefined,b,r.output.evidence,['unit'],f.text)).toMatchObject({detail:'unexpected-binding'});
 expect(inspectVerificationBinding(goal,b,[],['unit'],f.text)).toMatchObject({detail:'unit-missing'});
 expect(inspectVerificationBinding(goal,b,r.output.evidence,[],f.text)).toMatchObject({detail:'unit-uncited'});
 expect(inspectVerificationBinding(goal,b,[{...r.output.evidence[0]!,excerpt:'different'}],['unit'],f.text)).toMatchObject({detail:'unit-invalid'});
 expect(inspectVerificationBinding(goal,{...b,target:{...b.target,evidenceId:'other'}},r.output.evidence,['unit'],f.text)).toMatchObject({detail:'span-unit-mismatch'});
 expect(inspectVerificationBinding(goal,{...b,observation:{...b.observation!,metric:{...b.observation!.metric,evidenceId:'other'}}},r.output.evidence,['unit'],f.text)).toMatchObject({detail:'observation-span-unit-mismatch'});
 expect(inspectVerificationBinding(goal,{...b,observation:{...b.observation!,metric:{...b.observation!.metric,end:9999}}},r.output.evidence,['unit'],f.text)).toMatchObject({detail:'observation-span-range-invalid'});
 expect(inspectVerificationBinding(goal,{...b,observation:{...b.observation!,value:b.observation!.metric}},r.output.evidence,['unit'],f.text)).toMatchObject({detail:'observation-span-overlap'});
 const {observationPolicy:_policy,...legacy}=goal!;expect(inspectVerificationBinding(legacy,b,r.output.evidence,['unit'],f.text)).toMatchObject({detail:'unexpected-observation'});
});

test('binding child detail reaches orchestration without changing its outer failure',async()=>{
 const f=quotedFixture();f.wire.criterionScores[0]!.verificationBinding.goalVersion='private-version';const events:unknown[]=[];
 const sdk=await createEvaluationFixture(()=>({text:JSON.stringify(f.wire)}));
 await expect(evaluateTurn(f.input,{onDiagnostic:d=>events.push(d),evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',evidenceGrounding:'quoted-spans'})})).rejects.toThrow('MODEL_OUTPUT_INVALID');
 expect(events).toContainEqual({version:1,stage:'scoring',outcome:'rejected',reason:'score-binding-invalid',bindingIssue:'goal-version-mismatch'});
 expect(JSON.stringify(events)).not.toContain('private');expect(sdk.stats.providerCalls).toBe(1);
});

test('fixed binding detail reaches a diagnostic observer without echoing the model version',async()=>{
 const f=quotedFixture(),r=groundQuotedEvaluation(f.wire,f.text);if(!r.ok)throw Error('fixture');const seen:unknown[]=[];
 const execute=createScoringExecutor({...f.input.context,answerId:'a',answerText:f.text,evidence:r.output.evidence},[f.input.rubric],{onScoringRejection:(reason:unknown,detail:unknown)=>seen.push({reason,detail})});
 const scores=structuredClone(r.output.criterionScores);scores[0]!.verificationBinding!.goalVersion='private-model-version';
 expect((await execute('c',{rubricId:f.input.rubric.id,rubricVersion:'1',criterionScores:scores})).status).toBe('error');
 expect(seen).toEqual([{reason:'score-binding-invalid',detail:'goal-version-mismatch'}]);expect(JSON.stringify(seen)).not.toContain('private');
});
