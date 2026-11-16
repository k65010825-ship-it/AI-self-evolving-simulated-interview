import {test,expect} from 'bun:test';
import {normalizeOptionalBindings} from '../apps/agent/src/evaluation/normalize-wire.ts';
import {EvaluationOutputSchema} from '../packages/contracts/src/evaluation.ts';
import {fixtureAssessment,createEvaluationFixture} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {runtimeRequest} from './helpers/runtime-request.ts';
import {createPiEvaluator} from '../apps/agent/src/adapters/pi/evaluator.ts';
import {evaluateTurn} from '../apps/agent/src/orchestration/evaluate-turn.ts';

test('wire normalization omits only a host-optional null binding and preserves every score and quote',()=>{
 const input={...fixtureAssessment,criterionScores:fixtureAssessment.criterionScores.map(c=>({...c,verificationBinding:null}))};
 const before=structuredClone(input),criteria=input.criterionScores.map(c=>({id:c.criterionId}));
 const normalized=normalizeOptionalBindings(input,criteria);
 expect(normalized.changed).toBe(true);expect(EvaluationOutputSchema.parse(normalized.value)).toEqual(fixtureAssessment);expect(input).toEqual(before);
 const extra={...input,privateUnknownKey:'private-value'};expect(EvaluationOutputSchema.safeParse(normalizeOptionalBindings(extra,criteria).value).success).toBe(false);
});

test('wire normalization cannot erase a numeric goal binding requirement or invent missing evidence',()=>{
 for(const score of [0,3]){
  const input={criterionScores:[{criterionId:'verification',score,evidenceIds:[],verificationBinding:null}]};
  const n=normalizeOptionalBindings(input,[{id:'verification',verificationGoal:{}}]);expect(n.changed).toBe(false);expect(n.value).toEqual(input);
 }
 const unknown={criterionScores:[{criterionId:'unknown',score:null,evidenceIds:[],verificationBinding:null}]};
 expect(normalizeOptionalBindings(unknown,[]).changed).toBe(false);
 const abstain={criterionScores:[{criterionId:'verification',score:null,evidenceIds:[],verificationBinding:null}]};
 expect(normalizeOptionalBindings(abstain,[{id:'verification',verificationGoal:{}}]).value).toEqual({criterionScores:[{criterionId:'verification',score:null,evidenceIds:[]}]});
});

test('actual Pi evaluation canonicalizes optional null once, without extra provider call or state mutation',async()=>{
 const input=runtimeRequest('wire-null-binding').job.input,before=structuredClone(input.state),events:unknown[]=[];
 const output={...fixtureAssessment,criterionScores:fixtureAssessment.criterionScores.map(c=>({...c,verificationBinding:null}))};
 const f=await createEvaluationFixture(()=>({text:JSON.stringify(output)}));
 const result=await evaluateTurn(input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model,roleId:'java-backend',onDiagnostic:d=>events.push(d)})});
 expect(result.evaluation.dimensions.map(d=>d.score)).toEqual(fixtureAssessment.criterionScores.map(c=>c.score));
 expect(events).toContainEqual({version:1,stage:'schema',outcome:'repaired',reason:'optional-binding-omitted'});
 expect(f.stats.providerCalls).toBe(1);expect(input.state).toEqual(before);
});
