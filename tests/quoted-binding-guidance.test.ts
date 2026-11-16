import {test,expect} from 'bun:test';
import {createEvaluationFixture,fixtureAssessment} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {runtimeRequest} from './helpers/runtime-request.ts';
import {createPiEvaluator} from '../apps/agent/src/adapters/pi/evaluator.ts';
import {evaluateTurn} from '../apps/agent/src/orchestration/evaluate-turn.ts';
import {contentText} from '../experiments/pi-sdk/planner-fixture.ts';
import {quotedFixture} from '../experiments/quoted-spans/fixture.ts';
import {quotedOutputSchemaForRubric} from '../apps/agent/src/harness/skills/evaluation-quotes.ts';
test('a no-goal host rubric sends a quoted output schema that forbids verificationBinding',async()=>{
 const input=runtimeRequest('no-goal-schema').job.input;let schema:any;
 const sdk=await createEvaluationFixture(context=>{
  const prompt=context.messages.filter(m=>m.role==='system').map(m=>contentText(m.content)+'\n'+Object.values(m.sections??{}).join('\n')).join('\n');
  const start=prompt.lastIndexOf('Schema: ')+8,end=prompt.indexOf('\n',start);schema=JSON.parse(prompt.slice(start,end<0?undefined:end));
  return{text:JSON.stringify({...fixtureAssessment,evidence:fixtureAssessment.evidence.map(({id,excerpt})=>({id,excerpt}))})};
 });
 const result=await evaluateTurn(input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',evidenceGrounding:'quoted-spans'})});
 expect(result.evaluation.complete).toBe(true);expect(sdk.stats.providerCalls).toBe(1);
 for(const branch of schema.properties.criterionScores.items.anyOf){expect(branch.properties.verificationBinding).toBeUndefined();
  expect(branch.additionalProperties).toBe(false);expect(branch.properties.criterionId.const).toBe('correctness');}
});

test('mixed rubric schema binds goal identity only to its own criterion and forbids bindings on abstention',()=>{
 const f=quotedFixture(),first=f.input.rubric.criteria[0]!;
 const rubric={...f.input.rubric,criteria:[{...first,weight:.5},{id:'plain',maxScore:4,weight:.5,required:true}]};
 const schema=quotedOutputSchemaForRubric(rubric),scores=schema.properties.criterionScores,item=scores.items;
 expect(scores.minItems).toBe(2);expect(scores.maxItems).toBe(2);
 const goalRule=item.anyOf.find((r:any)=>r.properties.criterionId.const===first.id&&r.properties.score.type==='number');
 expect(goalRule.properties.verificationBinding.properties.goalId.const).toBe(first.verificationGoal!.id);
 expect(goalRule.properties.verificationBinding.properties.goalVersion.const).toBe(first.verificationGoal!.version);
 expect(goalRule.required).toContain('verificationBinding');expect(goalRule.properties.verificationBinding.required).toContain('observation');
 const plainRule=item.anyOf.find((r:any)=>r.properties.criterionId.const==='plain'&&r.properties.score.type==='number');
 expect(plainRule.properties.verificationBinding).toBeUndefined();expect(plainRule.properties.score.maximum).toBe(4);
 for(const branch of item.anyOf.filter((r:any)=>r.properties.score.type==='null')){expect(branch.properties.verificationBinding).toBeUndefined();expect(branch.properties.evidenceIds.maxItems).toBe(0);}
});
