import {test,expect} from 'bun:test';
import {runtimeRequest} from './helpers/runtime-request.ts';
import {createEvaluationFixture} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {contentText} from '../experiments/pi-sdk/planner-fixture.ts';
import {createPiEvaluator} from '../apps/agent/src/adapters/pi/evaluator.ts';
import {evaluateTurnWithClarification} from '../apps/agent/src/orchestration/clarify-turn.ts';
import {buildInterviewContext} from '../apps/agent/src/context/build-context.ts';
import {RubricSchema} from '../packages/contracts/src/scoring.ts';

for(const mode of ['quoted-spans','model-offsets']as const)test(mode+': shared decision rules and a complete missing-evidence format reach Pi without workflow keys',async()=>{
 const input=runtimeRequest('decision-'+mode).job.input;let observed='';
 const sdk=await createEvaluationFixture(context=>{observed=context.messages.filter(m=>m.role==='system').map(m=>contentText(m.content)+'\n'+Object.values(m.sections??{}).join('\n')).join('\n');
  return{text:JSON.stringify({evidence:[],criterionScores:[{criterionId:'correctness',score:null,evidenceIds:[]}],feedback:{strengths:[],improvements:['请补充针对问题的判断与理由。']}})};
 });
 const r=await evaluateTurnWithClarification({...input,answer:{id:'a',text:'相关经验我愿意进一步讨论，具体的技术判断还没有展开。'}},{evaluate:createPiEvaluator({cwd:process.cwd(),roleId:'java-backend',modelRuntime:sdk.runtime,model:sdk.model,evidenceGrounding:mode})});
 expect(r.status).toBe('needs_clarification');expect(sdk.stats.providerCalls).toBe(1);
 expect(observed).toContain('evidence-decision-v1');
 expect(observed).toContain('No relevant assessable assertion is UNKNOWN, not an incorrect answer');
 expect(observed).toContain('A substantive, question-relevant incorrect assertion may receive zero');
 expect(observed).toContain('The host alone decides clarification and abstention');
 expect(observed).toContain('"criterionId":"correctness","score":null,"evidenceIds":[]');
});
for(const mode of ['quoted-spans','model-offsets']as const)test(mode+': invalid host fields reject before prompt construction with sanitized application error',async()=>{
 const input=runtimeRequest('invalid-decision-'+mode).job.input,now=Date.now(),sdk=await createEvaluationFixture(()=>{throw Error('must not call');});
 const context=buildInterviewContext({state:input.state,now,phase:'scoring',goal:'当前题目',answer:input.answer.text,knowledge:[]});
 const evaluate=createPiEvaluator({cwd:process.cwd(),roleId:'java-backend',modelRuntime:sdk.runtime,model:sdk.model,evidenceGrounding:mode});
 for(const field of ['rubric','question']as const){const request={outputSchemaVersion:1 as const,context,question:{text:input.question.text,skillId:input.question.skillId,questionType:input.question.questionType,difficulty:input.question.difficulty},rubric:RubricSchema.parse(input.rubric)};
  Object.assign(request[field],{privateUnknownField:{mastery:1}});let failure:any;try{await evaluate(request,new AbortController().signal);}catch(e){failure=e;}
  expect(failure?.code).toBe('VALIDATION_ERROR');expect(failure?.message).not.toContain('privateUnknownField');expect(failure?.message).not.toContain('unrecognized_keys');
 }
 expect(sdk.stats.providerCalls).toBe(0);
});
