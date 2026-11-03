import{pathToFileURL}from'node:url';
import{createReflectionFixture}from'../experiments/reflection/session-fixture.ts';
import{createPolicyValidationSuite}from'../evals/policy/validation-scenarios.ts';
import{reflectSession}from'../apps/agent/src/reflection/reflect-session.ts';
import{createExperimentRegistry,applyExperimentOperation,pinSessionPolicy,restoreExperimentRegistry}from'../apps/agent/src/reflection/experiment-registry.ts';
import type{RoleId}from'../packages/contracts/src/tools.ts';
export async function runExperimentDemo(roleId:RoleId='java-backend'){
 const source=await createReflectionFixture(roleId),reflection=await reflectSession(source);
 if(!reflection.candidate)throw new Error('Fixture candidate missing');
 const identity={experimentId:`offline-${roleId}`,roleId},now=4000000;
 const initial=createExperimentRegistry({...identity,now,baselinePolicy:reflection.baselinePolicy});
 const oldPin=pinSessionPolicy(initial,{...identity,sessionId:'started-before',now});
 const evaluationInput={baseline:reflection.baselinePolicy,candidate:reflection.candidate,suite:createPolicyValidationSuite(roleId),
  developmentGroupIds:[source.sourceGroupId],developmentSessionIds:[reflection.sessionId]};
 const failedInput=structuredClone(evaluationInput);
 failedInput.suite.cases.filter(c=>c.tag==='depth_boundary').forEach(c=>c.expected={action:'deepen',skillId:'primary'});
 const rejected=applyExperimentOperation(initial,{...identity,operationId:'reject-1',action:'evaluate',expectedVersion:0,now:now+100,evaluationInput:failedInput});
 const activateRequest={...identity,operationId:'activate-1',action:'evaluate',expectedVersion:1,now:now+200,evaluationInput};
 const activated=applyExperimentOperation(rejected,activateRequest);
 const newPin=pinSessionPolicy(activated,{...identity,sessionId:'started-after',now:now+200});
 const rolledBack=applyExperimentOperation(activated,{...identity,operationId:'rollback-1',action:'rollback',expectedVersion:2,
  now:now+300,targetPolicyId:initial.initialPolicyId,reason:'离线审计回退演示'});
 const replayed=applyExperimentOperation(rolledBack,activateRequest);
 const recovered=restoreExperimentRegistry(JSON.stringify(replayed),identity);
 return{mode:'offline-experiment-state-machine',scope:recovered.scope,productionPublished:false,liveModelCalls:0,
  baselineId:initial.initialPolicyId,rejectedActiveId:rejected.activePolicyId,activatedActiveId:activated.activePolicyId,
  restoredActiveId:recovered.activePolicyId,registryVersion:recovered.version,oldPin,newPin,operations:recovered.operations};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const role of ['java-backend','web-frontend']as const)console.log(JSON.stringify(await runExperimentDemo(role),null,2));
}
