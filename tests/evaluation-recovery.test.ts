import{test,expect}from'bun:test';
import{createPiEvaluator}from'../apps/agent/src/adapters/pi/evaluator.ts';
import{createEvaluationFixture,fixtureAssessment}from'../experiments/pi-sdk/evaluation-fixture.ts';
import{evaluateTurn}from'../apps/agent/src/orchestration/evaluate-turn.ts';
import{runtimeRequest}from'./helpers/runtime-request.ts';
import{ModelRecoveryPolicySchema}from'../packages/contracts/src/model-recovery.ts';
const recovery=ModelRecoveryPolicySchema.parse({maxModelRepairs:1});
test('repair uses one absolute timeout and refuses synchronous completion after its deadline',async()=>{
 let now=0;const f=await createEvaluationFixture(()=>{now=21;return{text:'invalid'};});
 const evaluate=createPiEvaluator({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model,roleId:'java-backend',recovery,timeoutMs:20,now:()=>now});
 await expect(evaluateTurn(runtimeRequest('repair-clock').job.input,{evaluate})).rejects.toThrow('DEADLINE_EXCEEDED');expect(f.stats.providerCalls).toBe(1);
});
test('cancellation in recovery telemetry suppresses regeneration; throwing telemetry cannot veto valid repair',async()=>{
 for(const cancelled of [true,false]){let calls=0;const f=await createEvaluationFixture(()=>({text:++calls===1?'bad':JSON.stringify(fixtureAssessment)})),c=new AbortController();
  const evaluate=createPiEvaluator({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model,roleId:'java-backend',recovery,
   onRecovery:()=>{if(cancelled)c.abort();else throw Error('private-observer');}});
  const work=evaluateTurn(runtimeRequest('repair-sink-'+cancelled).job.input,{evaluate,signal:c.signal});
  if(cancelled){await expect(work).rejects.toThrow('RUN_CANCELLED');expect(calls).toBe(1);}else{expect((await work).kind).toBe('uncommitted-turn-proposal');expect(calls).toBe(2);}
 }
});
