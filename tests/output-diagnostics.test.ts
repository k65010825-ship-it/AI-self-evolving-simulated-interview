import { test,expect } from 'bun:test';
import { createEvaluationFixture,fixtureAssessment } from '../experiments/pi-sdk/evaluation-fixture.ts';
import { createPiEvaluator } from '../apps/agent/src/adapters/pi/evaluator.ts';
import { evaluateTurn } from '../apps/agent/src/orchestration/evaluate-turn.ts';
import { runtimeRequest } from './helpers/runtime-request.ts';
import { createLiveRunManager } from '../apps/agent/src/runtime/live-runtime.ts';
import liveConfig from '../apps/agent/src/model-access/bailian.example.json' with {type:'json'};
import {ModelRecoveryPolicySchema} from '../packages/contracts/src/model-recovery.ts';

test('Pi schema failure emits only fixed field and type categories, including through repair wrapper',async()=>{
 for(const maxModelRepairs of [0,1]){
  const events:unknown[]=[];const reply={...fixtureAssessment,criterionScores:fixtureAssessment.criterionScores.map(c=>({...c,verificationBinding:'private-invalid-binding'}))};
  const f=await createEvaluationFixture(()=>({text:JSON.stringify(reply)}));
  await expect(evaluateTurn(runtimeRequest('schema-fields-'+maxModelRepairs).job.input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model,
   roleId:'java-backend',recovery:ModelRecoveryPolicySchema.parse({maxModelRepairs}),onDiagnostic:e=>events.push(e)})})).rejects.toThrow('MODEL_OUTPUT_INVALID');
  expect(events).toContainEqual(expect.objectContaining({stage:'schema',reason:'invalid-schema',schemaIssue:{field:'criterionScores.verificationBinding',issue:'invalid_type',receivedType:'string'}}));
  expect(JSON.stringify(events)).not.toContain('private-invalid-binding');
  expect(f.stats.providerCalls).toBe(maxModelRepairs+1);
 }
});

test('invalid JSON and valid JSON with invalid schema emit distinct sanitized stages',async()=>{
 for(const [text,stage]of [['private-raw-output','json'],[JSON.stringify({unexpected:'private-raw-output'}),'schema']]as const){
  const diagnostics:unknown[]=[];const f=await createEvaluationFixture(()=>({text}));
  const input=runtimeRequest('diagnostic-'+stage).job.input;
  await expect(evaluateTurn(input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model,roleId:'java-backend',
   onDiagnostic:e=>diagnostics.push(e)})})).rejects.toThrow('MODEL_OUTPUT_INVALID');
  expect(diagnostics).toContainEqual(expect.objectContaining({stage,outcome:'rejected'}));
  expect(JSON.stringify(diagnostics)).not.toContain('private-raw-output');expect(f.stats.providerCalls).toBe(1);
 }
});
test('json fence repair is explicit, preserves values, and makes no second provider call',async()=>{
 for(const enabled of [false,true]){
  const diagnostics:unknown[]=[];const f=await createEvaluationFixture(()=>({text:'```json\n'+JSON.stringify(fixtureAssessment)+'\n```'}));
  const input=runtimeRequest('repair-'+enabled).job.input;
  const work=evaluateTurn(input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model,roleId:'java-backend',
   outputRepair:enabled?'json-fence-only':'none',onDiagnostic:e=>diagnostics.push(e)})});
  if(enabled){const p=await work;expect(p.evidence).toEqual(fixtureAssessment.evidence);expect(p.feedback).toEqual(fixtureAssessment.feedback);
   expect(diagnostics).toContainEqual(expect.objectContaining({stage:'json',outcome:'repaired',reason:'json-fence-unwrapped'}));
  }else await expect(work).rejects.toThrow('MODEL_OUTPUT_INVALID');
  expect(f.stats.providerCalls).toBe(1);
 }
});
test('evidence mismatches and scoring errors have distinct host stages without mutating the state',async()=>{
 for(const [stage,reply]of [['evidence',{...fixtureAssessment,evidence:[{id:'e1',start:0,end:4,excerpt:'伪造引文'}]}],
  ['scoring',{...fixtureAssessment,criterionScores:[{criterionId:'correctness',score:99,evidenceIds:['e1']}]}]]as const){
  const diagnostics:unknown[]=[];const input=runtimeRequest('host-'+stage).job.input,before=structuredClone(input.state);
  await expect(evaluateTurn(input,{evaluate:async()=>reply,onDiagnostic:e=>diagnostics.push(e)})).rejects.toThrow('MODEL_OUTPUT_INVALID');
  expect(diagnostics).toContainEqual(expect.objectContaining({stage,outcome:'rejected'}));expect(input.state).toEqual(before);
 }
});
test('repair never extracts prose, fixes malformed JSON, invents fields or repairs evidence',async()=>{
 const invalid=[['explanation\n```json\n'+JSON.stringify(fixtureAssessment)+'\n```','json'],
  ['```json\n{"evidence":[],}\n```','json'],['```json\n{}\n```','schema'],
  ['```json\n'+JSON.stringify({...fixtureAssessment,evidence:[{id:'e1',start:0,end:4,excerpt:'伪造引文'}]})+'\n```','evidence']]as const;
 for(const [text,stage]of invalid){
  const diagnostics:unknown[]=[];const f=await createEvaluationFixture(()=>({text}));
  const input=runtimeRequest('reject-'+stage).job.input;
  await expect(evaluateTurn(input,{onDiagnostic:e=>diagnostics.push(e),evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model,
   roleId:'java-backend',outputRepair:'json-fence-only',onDiagnostic:e=>diagnostics.push(e)})})).rejects.toThrow('MODEL_OUTPUT_INVALID');
  expect(diagnostics).toContainEqual(expect.objectContaining({stage,outcome:'rejected'}));expect(f.stats.providerCalls).toBe(1);
 }
});
test('throwing diagnostic sink cannot turn a valid answer into failure or leak its error',async()=>{
 const f=await createEvaluationFixture(()=>({text:JSON.stringify(fixtureAssessment)}));
 const onDiagnostic=()=>{throw Error('private-observer-error');};
 const p=await evaluateTurn(runtimeRequest('sink-error').job.input,{onDiagnostic,evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:f.runtime,
  model:f.model,roleId:'java-backend',onDiagnostic})});expect(p.kind).toBe('uncommitted-turn-proposal');
});
test('cancelled or timed out SDK work cannot add a late accepted diagnostic',async()=>{
 for(const cancelled of [true,false]){
  const diagnostics:unknown[]=[];let entered!:()=>void,release!:(reply:{text:string})=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const f=await createEvaluationFixture(()=>{entered();return new Promise(resolve=>{release=resolve;});});
  const controller=new AbortController();
  const work=evaluateTurn(runtimeRequest('late-'+cancelled).job.input,{signal:controller.signal,evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:f.runtime,
   model:f.model,roleId:'java-backend',timeoutMs:cancelled?1000:40,onDiagnostic:e=>diagnostics.push(e)})});
  await started;if(cancelled)controller.abort();await expect(work).rejects.toThrow(cancelled?'RUN_CANCELLED':'DEADLINE_EXCEEDED');
  const before=structuredClone(diagnostics);release({text:JSON.stringify(fixtureAssessment)});await new Promise(resolve=>setTimeout(resolve,5));
  expect(diagnostics).toEqual(before);expect(diagnostics).toEqual([]);expect(f.stats.providerCalls).toBe(1);
 }
});
test('live runtime collects bounded copy-isolated diagnostics and format repair still charges only one HTTP',async()=>{
 for(const repair of [false,true]){let calls=0;
  const config={...liveConfig,outputRepair:repair?'json-fence-only':'none',authorization:{...liveConfig.authorization,enabled:true,operatorApproved:true,expiresAt:Date.now()+60000}};
  const runtime=createLiveRunManager(config,{readCredential:()=> 'synthetic-private-key',fetch:async()=>{
   calls++;const text=repair?'```json\n'+JSON.stringify(fixtureAssessment)+'\n```':'synthetic-private-output';
   return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:'stop'}]})+'\n\n'+
    'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}})+'\n\ndata: [DONE]\n\n',
    {headers:{'content-type':'text/event-stream'}});
  }});
  try{const r=runtimeRequest('runtime-diagnostic-'+repair);runtime.start(r);await runtime.wait(r.context.runId);
   expect(runtime.snapshot(r.context.runId).status).toBe(repair?'completed':'failed');expect(calls).toBe(1);
   expect(runtime.modelAccounting()[0]!.totals.usedTokens).toBe(130);
   const diagnostic=runtime.evaluationDiagnostics()[0]!;expect(diagnostic.runId).toBe(r.context.runId);expect(diagnostic.events.length).toBeLessThanOrEqual(16);
   expect(diagnostic.events).toContainEqual(expect.objectContaining({stage:'json',outcome:repair?'repaired':'rejected'}));
   expect(JSON.stringify(diagnostic)).not.toContain('synthetic-private');diagnostic.events.length=0;
   expect(runtime.evaluationDiagnostics()[0]!.events.length).toBeGreaterThan(0);
  }finally{runtime.dispose();}
 }
});
test('evidence diagnostics distinguish duplicate IDs, ranges, missing quotes and position ambiguity',async()=>{
 const cases=[
  {answer:'事务边界',evidence:[{id:'e1',start:0,end:2,excerpt:'事务边界'}],reason:'evidence-offset-mismatch'},
  {answer:'事务边界',evidence:[{id:'e1',start:0,end:99,excerpt:'事务边界'}],reason:'evidence-offset-out-of-range'},
  {answer:'事务边界',evidence:[{id:'e1',start:0,end:4,excerpt:'不在原文'}],reason:'evidence-quote-absent'},
  {answer:'事务边界事务边界',evidence:[{id:'e1',start:1,end:5,excerpt:'事务边界'}],reason:'evidence-quote-ambiguous'},
  {answer:'事务边界',evidence:[{id:'e1',start:0,end:4,excerpt:'事务边界'},{id:'e1',start:0,end:4,excerpt:'事务边界'}],reason:'evidence-id-duplicate'},
 ];
 for(const c of cases){const events:unknown[]=[];const input=runtimeRequest('evidence-detail').job.input;input.answer.text=c.answer;
  await expect(evaluateTurn(input,{evaluate:async()=>({...fixtureAssessment,evidence:c.evidence}),onDiagnostic:e=>events.push(e)})).rejects.toThrow('MODEL_OUTPUT_INVALID');
  expect(events).toContainEqual(expect.objectContaining({stage:'evidence',outcome:'rejected',reason:c.reason}));
 }
});
test('host unique-excerpt grounding fixes only positions, stays explicit and preserves Unicode and scores',async()=>{
 for(const enabled of [false,true]){
  const input=runtimeRequest('ground-'+enabled).job.input;input.answer.text='先看😀，再说明事务边界。';
  const reply={...fixtureAssessment,evidence:[{id:'e1',start:0,end:4,excerpt:'事务边界'}]};const before=structuredClone(reply);
  const f=await createEvaluationFixture(()=>({text:JSON.stringify(reply)}));const events:unknown[]=[];
  const work=evaluateTurn(input,{onDiagnostic:e=>events.push(e),evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model,
   roleId:'java-backend',evidenceGrounding:enabled?'unique-excerpt':'model-offsets',onDiagnostic:e=>events.push(e)})});
  if(enabled){const p=await work;expect(p.evidence).toEqual([{...reply.evidence[0]!,start:input.answer.text.indexOf('事务边界'),end:input.answer.text.indexOf('事务边界')+4}]);
   expect(p.evaluation.dimensions[0]!.score).toBe(fixtureAssessment.criterionScores[0]!.score);
   expect(events).toContainEqual(expect.objectContaining({stage:'evidence',outcome:'repaired',reason:'unique-excerpt-grounded'}));
  }else await expect(work).rejects.toThrow('MODEL_OUTPUT_INVALID');
  expect(reply).toEqual(before);expect(f.stats.providerCalls).toBe(1);
 }
});
test('host grounding rejects absent or ambiguous quotes, duplicate IDs and invalid scores',async()=>{
 for(const [answer,evidence,scores]of [
  ['事务边界',[{id:'e1',start:0,end:4,excerpt:'伪造引文'}],fixtureAssessment.criterionScores],
  ['哈哈哈',[{id:'e1',start:0,end:2,excerpt:'哈哈'}],fixtureAssessment.criterionScores],
  ['事务边界',[{id:'e1',start:0,end:4,excerpt:'事务边界'},{id:'e1',start:0,end:4,excerpt:'事务边界'}],fixtureAssessment.criterionScores],
  ['事务边界',[{id:'e1',start:0,end:2,excerpt:'事务边界'}],[{criterionId:'correctness',score:99,evidenceIds:['e1']}]],
 ]as const){const input=runtimeRequest('ground-reject').job.input;input.answer.text=answer;
  const f=await createEvaluationFixture(()=>({text:JSON.stringify({...fixtureAssessment,evidence,criterionScores:scores})}));
  await expect(evaluateTurn(input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model,roleId:'java-backend',
   evidenceGrounding:'unique-excerpt'})})).rejects.toThrow('MODEL_OUTPUT_INVALID');expect(f.stats.providerCalls).toBe(1);
 }
});
