import {test,expect} from 'bun:test';
import {createEvaluationFixture,fixtureAssessment} from '../experiments/pi-sdk/evaluation-fixture.ts';
import {createPiEvaluator} from '../apps/agent/src/adapters/pi/evaluator.ts';
import {evaluateTurn} from '../apps/agent/src/orchestration/evaluate-turn.ts';
import {runtimeRequest} from './helpers/runtime-request.ts';
import {ModelRecoveryPolicySchema} from '../packages/contracts/src/model-recovery.ts';
import {AgentStateError} from '../apps/agent/src/planning/interview-state.ts';
import {quotedFixture} from '../experiments/quoted-spans/fixture.ts';

test('JSON fence policy is explicit and local repair preserves the exact candidate without another provider call',async()=>{
 for(const enabled of [false,true]){const events:unknown[]=[],sdk=await createEvaluationFixture(()=>({text:'```json\n'+JSON.stringify(fixtureAssessment)+'\n```'}));
  const work=evaluateTurn(runtimeRequest('json-fence-'+enabled).job.input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',outputRepair:enabled?'json-fence-only':'none',onDiagnostic:d=>events.push(d)})});
  if(enabled){const r=await work;expect(r.feedback).toEqual(fixtureAssessment.feedback);expect(r.evaluation.dimensions[0]!.score).toBe(4);}
  else{await expect(work).rejects.toThrow('MODEL_OUTPUT_INVALID');expect(events).toContainEqual(expect.objectContaining({version:1,stage:'json',outcome:'rejected',reason:'invalid-json',jsonIssue:'fence-disabled',jsonShape:expect.any(Object)}));}
  expect(sdk.stats.providerCalls).toBe(1);
 }
});

test('local fence recovery composes with both-role quote grounding and preserves a valid zero',async()=>{
 for(const role of ['java-backend','web-frontend']as const){const f=quotedFixture(role,0),sdk=await createEvaluationFixture(()=>({text:'```json\n'+JSON.stringify(f.wire)+'\n```'}));
  const r=await evaluateTurn(f.input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:role,outputRepair:'json-fence-only',evidenceGrounding:'quoted-spans'})});
  expect(r.evaluation.normalizedScore).toBe(0);expect(sdk.stats.providerCalls).toBe(1);
 }
});

test('JSON diagnostics distinguish syntax, unclosed structure and duplicate keys without retaining private text',async()=>{
 for(const [text,jsonIssue]of [['{"private-value":,}','invalid-syntax'],['{"private-value":','unclosed-structure'],['{"private-key":0,"private-key":4}','duplicate-key'],
  [JSON.stringify(fixtureAssessment).replace('"score":4','"score":0,"score":4'),'duplicate-key']]as const){
  const events:unknown[]=[],sdk=await createEvaluationFixture(()=>({text}));
  await expect(evaluateTurn(runtimeRequest('json-'+jsonIssue).job.input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',outputRepair:'json-fence-only',onDiagnostic:d=>events.push(d)})})).rejects.toThrow('MODEL_OUTPUT_INVALID');
  expect(events).toContainEqual(expect.objectContaining({version:1,stage:'json',outcome:'rejected',reason:'invalid-json',jsonIssue,jsonShape:expect.any(Object)}));expect(JSON.stringify(events)).not.toContain('private');expect(sdk.stats.providerCalls).toBe(1);
 }
});

test('bounded regeneration reuses original task and preserves failure details; budget rejection prevents a second generation',async()=>{
 for(const mode of ['recover','exhaust','budget']as const){let calls=0,reservations=0;const events:unknown[]=[];
  const sdk=await createEvaluationFixture(()=>({text:++calls===1||mode!=='recover'?'{} {}':JSON.stringify(fixtureAssessment)}));
  const work=evaluateTurn(runtimeRequest('json-repair-'+mode).job.input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',recovery:ModelRecoveryPolicySchema.parse({maxModelRepairs:1}),
   beforeRepair:()=>{reservations++;if(mode==='budget')throw new AgentStateError('TOOL_BUDGET_EXCEEDED');},onDiagnostic:d=>events.push(d)})});
  if(mode==='recover')expect((await work).evaluation.dimensions[0]!.score).toBe(4);
  else await expect(work).rejects.toThrow(mode==='budget'?'TOOL_BUDGET_EXCEEDED':'MODEL_OUTPUT_INVALID');
  expect(calls).toBe(mode==='budget'?1:2);expect(reservations).toBe(1);
  expect(events).toContainEqual(expect.objectContaining({version:1,stage:'json',outcome:'rejected',reason:'invalid-json',jsonIssue:'surrounding-content',jsonShape:expect.any(Object)}));
 }
});

test('length stop rejects even parseable JSON and is not routed into format regeneration',async()=>{
 const events:unknown[]=[],sdk=await createEvaluationFixture(()=>({text:JSON.stringify(fixtureAssessment),stopReason:'length'}));let repairs=0;
 await expect(evaluateTurn(runtimeRequest('json-length').job.input,{evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',recovery:ModelRecoveryPolicySchema.parse({maxModelRepairs:1}),beforeRepair:()=>{repairs++;},onDiagnostic:d=>events.push(d)})})).rejects.toThrow('MODEL_OUTPUT_INVALID');
 expect(events).toContainEqual({version:1,stage:'finalization',outcome:'rejected',reason:'completion-incomplete',jsonIssue:'generation-incomplete'});expect(repairs).toBe(0);expect(sdk.stats.providerCalls).toBe(1);
});

test('cancellation at JSON rejection revokes regeneration without updating capability state',async()=>{
 const input=runtimeRequest('json-cancel').job.input,before=structuredClone(input.state),controller=new AbortController();let repairs=0;
 const sdk=await createEvaluationFixture(()=>({text:'{"x":'}));
 await expect(evaluateTurn(input,{signal:controller.signal,evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:sdk.runtime,model:sdk.model,roleId:'java-backend',recovery:ModelRecoveryPolicySchema.parse({maxModelRepairs:1}),
  beforeRepair:()=>{repairs++;},onDiagnostic:d=>{if(d.stage==='json'&&d.outcome==='rejected')controller.abort();}})})).rejects.toThrow('RUN_CANCELLED');
 expect(repairs).toBe(0);expect(sdk.stats.providerCalls).toBe(1);expect(input.state).toEqual(before);
});
