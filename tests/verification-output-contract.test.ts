import {test,expect} from 'bun:test';
import {quotedOutputSchemaForRubric,promptForRubric} from '../apps/agent/src/harness/skills/evaluation-quotes.ts';
import {quotedFixture} from '../experiments/quoted-spans/fixture.ts';
import {createEvaluationFixture} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {createPiEvaluator} from '../apps/agent/src/adapters/pi/evaluator.ts';
import {evaluateTurn} from '../apps/agent/src/orchestration/evaluate-turn.ts';
import {contentText} from '../experiments/pi-sdk/planner-fixture.ts';
import {buildInterviewContext} from '../apps/agent/src/context/build-context.ts';
import {z} from 'zod';

test('mixed goal contract lists closed numeric/null alternatives without nested conditional rules',()=>{
 const f=quotedFixture(),goal=f.input.rubric.criteria[0]!;
 const rubric={...f.input.rubric,criteria:[{...goal,weight:.5},{id:'plain',weight:.5,maxScore:2,required:true}]};
 const schema=quotedOutputSchemaForRubric(rubric),branches=schema.properties.criterionScores.items.anyOf;
 expect(branches).toHaveLength(4);
 const numeric=branches.find((b:any)=>b.properties.criterionId.const===goal.id&&b.properties.score.type==='number');
 expect(numeric.required).toContain('verificationBinding');expect(numeric.additionalProperties).toBe(false);
 expect(numeric.properties.verificationBinding.properties.goalId.const).toBe(goal.verificationGoal!.id);
 for(const b of branches){expect(b.allOf).toBeUndefined();expect(b.properties.feedback).toBeUndefined();expect(b.required).toEqual(expect.arrayContaining(['criterionId','score','evidenceIds']));
  if(b.properties.score.type==='null'){expect(b.properties.verificationBinding).toBeUndefined();expect(b.properties.evidenceIds.maxItems).toBe(0);}
  if(b.properties.criterionId.const==='plain'){expect(b.properties.verificationBinding).toBeUndefined();}
 }
 expect(schema.required).toEqual(expect.arrayContaining(['evidence','criterionScores','feedback']));
 expect(schema.properties.feedback.required).toEqual(expect.arrayContaining(['strengths','improvements']));
 expect(promptForRubric(rubric)).toContain('feedback is a REQUIRED ROOT SIBLING');
});

test('goal without observation has a closed binding; oversized rubric fails before provider rather than dropping rules',async()=>{
 const f=quotedFixture(),first=f.input.rubric.criteria[0]!,{observationPolicy,...goal}=first.verificationGoal!;
 const noObservation={...f.input.rubric,criteria:[{...first,verificationGoal:goal}]};
 const schema=quotedOutputSchemaForRubric(noObservation),binding=schema.properties.criterionScores.items.anyOf[0].properties.verificationBinding;
 expect(binding.properties.observation).toBeUndefined();expect(binding.required).not.toContain('observation');
 const rubric={...f.input.rubric,criteria:Array.from({length:20},(_,i)=>({...first,id:'criterion-'+i,weight:1/20}))};
 const large=quotedOutputSchemaForRubric(rubric);expect(large.properties.criterionScores.items.anyOf).toHaveLength(40);
 const sdk=await createEvaluationFixture(()=>{throw Error('must not call');});
 const evaluate=createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',evidenceGrounding:'quoted-spans',maxRequestCharacters:24000});
 const context=buildInterviewContext({state:f.input.state,now:Date.now(),phase:'scoring',goal:'测试边界',answer:f.text,knowledge:[]});
 const request={outputSchemaVersion:1 as const,context,question:{text:f.input.question.text,skillId:f.input.question.skillId,questionType:f.input.question.questionType,difficulty:f.input.question.difficulty},rubric};
 await expect(evaluate(request,new AbortController().signal)).rejects.toThrow('CONTEXT_BUDGET_EXCEEDED');expect(sdk.stats.providerCalls).toBe(0);
});

test('real Pi receives root topology rules while misplaced feedback and missing root feedback stay refused',async()=>{
 const f=quotedFixture();let prompt='';
 const wrong={evidence:f.wire.evidence,criterionScores:f.wire.criterionScores.map(c=>({...c,feedback:f.wire.feedback}))};
 const before=structuredClone(wrong),sdk=await createEvaluationFixture(context=>{prompt=context.messages.filter(m=>m.role==='system').map(m=>contentText(m.content)+'\n'+Object.values(m.sections??{}).join('\n')).join('\n');return{text:JSON.stringify(wrong)};});
 const events:unknown[]=[];
 await expect(evaluateTurn(f.input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',evidenceGrounding:'quoted-spans',onDiagnostic:e=>events.push(e)})})).rejects.toThrow('MODEL_OUTPUT_INVALID');
 expect(prompt).toContain('feedback is a REQUIRED ROOT SIBLING');expect(prompt).toContain('Final structure check');expect(sdk.stats.providerCalls).toBe(1);expect(wrong).toEqual(before);expect(f.input.state.observations).toHaveLength(0);
 expect(events).toContainEqual(expect.objectContaining({stage:'schema',schemaIssue:{field:'criterionScores',issue:'unrecognized_keys',receivedType:'object'}}));
 expect(events).toContainEqual(expect.objectContaining({stage:'schema',schemaIssue:{field:'feedback',issue:'invalid_type',receivedType:'missing'}}));
});

test('compiled JSON schema accepts goal/plain numeric and null samples, rejecting misplaced or missing fields',()=>{
 const f=quotedFixture(),first=f.input.rubric.criteria[0]!;
 const rubric={...f.input.rubric,criteria:[{...first,weight:.5},{id:'plain',weight:.5,maxScore:2,required:true}]};
 // Interpret the generated schema, rather than only asserting how its fields were assembled.
 const compiled=z.fromJSONSchema(quotedOutputSchemaForRubric(rubric));
 for(const score of [0,3,null])for(const plainScore of [0,2,null]){
  const goalItem=score===null?{criterionId:first.id,score:null,evidenceIds:[]}:{...f.wire.criterionScores[0]!,score};
  const plain={criterionId:'plain',score:plainScore,evidenceIds:plainScore===null?[]:['unit']};
  const candidate={evidence:f.wire.evidence,criterionScores:[goalItem,plain],feedback:f.wire.feedback};
  expect(compiled.safeParse(candidate).success).toBe(true);
  expect(compiled.safeParse({...candidate,feedback:undefined}).success).toBe(false);
  expect(compiled.safeParse({...candidate,criterionScores:[{...goalItem,feedback:f.wire.feedback},plain]}).success).toBe(false);
  expect(compiled.safeParse({...candidate,criterionScores:[goalItem,{...plain,verificationBinding:f.wire.criterionScores[0]!.verificationBinding}]}).success).toBe(false);
 }
 const noObservation={...first,verificationGoal:{...first.verificationGoal!,observationPolicy:undefined}};
 const without=z.fromJSONSchema(quotedOutputSchemaForRubric({...f.input.rubric,criteria:[noObservation]}));
 expect(without.safeParse(f.wire).success).toBe(false);
 const wire=structuredClone(f.wire),{observation,...binding}=wire.criterionScores[0]!.verificationBinding;
 expect(without.safeParse({...wire,criterionScores:[{...wire.criterionScores[0]!,verificationBinding:binding}]}).success).toBe(true);
 const required=z.fromJSONSchema(quotedOutputSchemaForRubric(f.input.rubric));
 expect(required.safeParse({...wire,criterionScores:[{...wire.criterionScores[0]!,verificationBinding:binding}]}).success).toBe(false);
});
