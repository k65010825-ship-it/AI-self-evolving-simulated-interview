import{test,expect}from'bun:test';
import{createExperimentRegistry,applyExperimentOperation,pinSessionPolicy,restoreExperimentRegistry}from'../apps/agent/src/reflection/experiment-registry.ts';
import{createReflectionFixture}from'../experiments/reflection/session-fixture.ts';
import{reflectSession}from'../apps/agent/src/reflection/reflect-session.ts';
import{createPolicyValidationSuite}from'../evals/policy/validation-scenarios.ts';
async function fixture(){
 const source=await createReflectionFixture();const reflection=await reflectSession(source);
 if(!reflection.candidate)throw new Error('Missing candidate');
 const now=4000000,identity={experimentId:'offline-java',roleId:'java-backend'};
 const registry=createExperimentRegistry({...identity,now,baselinePolicy:reflection.baselinePolicy});
 const request={...identity,action:'evaluate',operationId:'evaluate-1',expectedVersion:0,now:now+1000,
  evaluationInput:{baseline:reflection.baselinePolicy,candidate:reflection.candidate,suite:createPolicyValidationSuite(),
   developmentGroupIds:[source.sourceGroupId],developmentSessionIds:[reflection.sessionId]}};
 return{registry,request,identity,now};
}
test('recomputes validation and activates only the isolated experiment policy',async()=>{
 const f=await fixture();const next=applyExperimentOperation(f.registry,f.request);
 expect(next.scope).toBe('offline-experiment');expect(next.version).toBe(1);
 expect(next.activePolicyId).toBe(f.request.evaluationInput.candidate.id);
 expect(next.operations[0]?.outcome).toBe('activated');expect(f.registry.activePolicyId).toBe(f.request.evaluationInput.baseline.id);
});
test('valid but failed evaluation records rejection and preserves active baseline',async()=>{
 const f=await fixture();f.request.evaluationInput.suite.cases.filter(c=>c.tag==='depth_boundary').forEach(c=>c.expected={action:'deepen',skillId:'primary'});
 const next=applyExperimentOperation(f.registry,f.request);
 expect(next.version).toBe(1);expect(next.activePolicyId).toBe(f.registry.activePolicyId);
 expect(next.operations[0]?.outcome).toBe('rejected');expect(next.policies).toHaveLength(1);
});
test('does not accept caller-provided successful evaluation instead of full validation input',async()=>{
 const f=await fixture();expect(()=>applyExperimentOperation(f.registry,{...f.request,result:{status:'passed'}})).toThrow('VALIDATION_ERROR');
});
test('stale versions, changed baseline and policy ID collisions cannot activate',async()=>{
 const f=await fixture();expect(()=>applyExperimentOperation(f.registry,{...f.request,expectedVersion:1})).toThrow('VERSION_CONFLICT');
 const activated=applyExperimentOperation(f.registry,f.request);
 expect(()=>applyExperimentOperation(activated,{...f.request,operationId:'new-id',expectedVersion:1,now:f.request.now+1})).toThrow('VERSION_CONFLICT');
});
test('rollback returns to an ancestor and keeps existing session policy pins unchanged',async()=>{
 const f=await fixture();const old=pinSessionPolicy(f.registry,{...f.identity,sessionId:'old',now:f.now});
 const activated=applyExperimentOperation(f.registry,f.request);
 const fresh=pinSessionPolicy(activated,{...f.identity,sessionId:'fresh',now:f.request.now});
 expect(old.policy.parameters.maxFollowupDepth).toBe(2);expect(fresh.policy.parameters.maxFollowupDepth).toBe(1);
 const reverted=applyExperimentOperation(activated,{...f.identity,operationId:'rollback-1',action:'rollback',expectedVersion:1,
  now:f.request.now+1000,targetPolicyId:f.registry.activePolicyId,reason:'离线人工审计回退'});
 expect(reverted.activePolicyId).toBe(f.registry.activePolicyId);expect(reverted.version).toBe(2);
 expect(fresh.policy.parameters.maxFollowupDepth).toBe(1);expect(old.policy.parameters.maxFollowupDepth).toBe(2);
});
test('same operation replay after rollback is idempotent, while changed payload conflicts',async()=>{
 const f=await fixture();const activated=applyExperimentOperation(f.registry,f.request);
 const reverted=applyExperimentOperation(activated,{...f.identity,operationId:'rollback-1',action:'rollback',expectedVersion:1,
  now:f.request.now+1000,targetPolicyId:f.registry.activePolicyId,reason:'audit'});
 expect(applyExperimentOperation(reverted,f.request).version).toBe(2);
 const changed=structuredClone(f.request);changed.evaluationInput.suite.version='other';
 expect(()=>applyExperimentOperation(reverted,changed)).toThrow('VERSION_CONFLICT');
});
test('checks experiment scope, role, monotonic operation time and rollback targets',async()=>{
 const f=await fixture();
 expect(()=>applyExperimentOperation(f.registry,{...f.request,experimentId:'other'})).toThrow('FORBIDDEN');
 expect(()=>applyExperimentOperation(f.registry,{...f.request,roleId:'web-frontend'})).toThrow('ROLE_FORBIDDEN');
 expect(()=>applyExperimentOperation(f.registry,{...f.request,now:f.now-1})).toThrow('VALIDATION_ERROR');
 expect(()=>applyExperimentOperation(f.registry,{...f.identity,operationId:'r',action:'rollback',expectedVersion:0,now:f.now,
  targetPolicyId:'unknown',reason:'audit'})).toThrow('VERSION_CONFLICT');
});
test('snapshot restore validates identity and the complete audit transition chain',async()=>{
 const f=await fixture();const activated=applyExperimentOperation(f.registry,f.request);
 expect(restoreExperimentRegistry(JSON.stringify(activated),f.identity)).toEqual(activated);
 expect(()=>restoreExperimentRegistry('{',f.identity)).toThrow('VALIDATION_ERROR');
 expect(()=>restoreExperimentRegistry(JSON.stringify(activated),{...f.identity,roleId:'web-frontend'})).toThrow('ROLE_FORBIDDEN');
 const changed=structuredClone(activated);changed.activePolicyId=f.registry.activePolicyId;
 expect(()=>restoreExperimentRegistry(JSON.stringify(changed),f.identity)).toThrow('VALIDATION_ERROR');
});
test('long baseline identifiers still produce a candidate that can be pinned as a policy version',async()=>{
 const source=await createReflectionFixture();const longId='b'.repeat(80);
 source.baselinePolicy.id=longId;source.reportInput.policyVersion=longId;
 source.reportInput.turns.forEach(t=>t.input.planningPolicy.id=longId);
 const reflected=await reflectSession(source);if(!reflected.candidate)throw new Error('Missing long-ID candidate');
 expect(reflected.candidate.id.length).toBeLessThanOrEqual(80);
 const registry=createExperimentRegistry({experimentId:'long',roleId:'java-backend',now:4000000,baselinePolicy:reflected.baselinePolicy});
 const next=applyExperimentOperation(registry,{experimentId:'long',roleId:'java-backend',action:'evaluate',operationId:'e',expectedVersion:0,now:4000001,
  evaluationInput:{baseline:reflected.baselinePolicy,candidate:reflected.candidate,suite:createPolicyValidationSuite(),developmentGroupIds:[source.sourceGroupId]}});
 expect(pinSessionPolicy(next,{experimentId:'long',roleId:'java-backend',sessionId:'s',now:4000001}).policy.id).toBe(reflected.candidate.id);
});
test('policy ID collisions are rejected and pin copies cannot mutate registry policies',async()=>{
 const f=await fixture();const collision=structuredClone(f.request);collision.evaluationInput.candidate.id=f.registry.initialPolicyId;
 expect(()=>applyExperimentOperation(f.registry,collision)).toThrow('VERSION_CONFLICT');
 const pin=pinSessionPolicy(f.registry,{...f.identity,sessionId:'detached',now:f.now});pin.policy.parameters.maxTurns=200;
 expect(f.registry.policies[0]?.parameters.maxTurns).toBe(12);
});
test('rollback cannot move forward to a known descendant and reevaluation can reuse the same immutable candidate',async()=>{
 const f=await fixture();const active=applyExperimentOperation(f.registry,f.request);
 const rollback={...f.identity,operationId:'r',action:'rollback',expectedVersion:1,now:f.request.now+1,targetPolicyId:f.registry.initialPolicyId,reason:'audit'};
 const reverted=applyExperimentOperation(active,rollback);
 expect(()=>applyExperimentOperation(reverted,{...rollback,operationId:'forward',expectedVersion:2,now:rollback.now+1,targetPolicyId:active.activePolicyId}))
  .toThrow('VERSION_CONFLICT');
 const again=applyExperimentOperation(reverted,{...f.request,operationId:'reevaluate',expectedVersion:2,now:rollback.now+1});
 expect(again.policies).toHaveLength(2);expect(again.activePolicyId).toBe(active.activePolicyId);
});
test('capacity overflow and audit tampering are rejected without partial mutation',async()=>{
 const f=await fixture();f.request.evaluationInput.suite.cases.filter(c=>c.tag==='depth_boundary').forEach(c=>c.expected={action:'deepen',skillId:'primary'});
 let full=f.registry;for(let i=0;i<50;i++)full=applyExperimentOperation(full,{...f.request,operationId:`rejected-${i}`,expectedVersion:i,now:f.request.now+i});
 expect(()=>applyExperimentOperation(full,{...f.request,operationId:'overflow',expectedVersion:50,now:f.request.now+50})).toThrow('VALIDATION_ERROR');
 expect(full.operations).toHaveLength(50);
 const bad=structuredClone(full);bad.operations[0]!.requestDigest='bad';
 expect(()=>restoreExperimentRegistry(JSON.stringify(bad),f.identity)).toThrow('VALIDATION_ERROR');
});
