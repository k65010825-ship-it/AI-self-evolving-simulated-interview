import{pathToFileURL}from'node:url';
import{createReflectionFixture}from'../experiments/reflection/session-fixture.ts';
import{createPolicyValidationSuite}from'../evals/policy/validation-scenarios.ts';
import{reflectSession}from'../apps/agent/src/reflection/reflect-session.ts';
import{evaluatePolicyCandidate}from'../apps/agent/src/reflection/evaluate-policy.ts';
import type{RoleId}from'../packages/contracts/src/tools.ts';
export async function runReflectionDemo(roleId:RoleId='java-backend'){
 const source=await createReflectionFixture(roleId);const reflection=await reflectSession(source);
 if(!reflection.candidate)throw new Error('Expected fixture policy candidate');
 const evaluation=evaluatePolicyCandidate({baseline:reflection.baselinePolicy,candidate:reflection.candidate,
  suite:createPolicyValidationSuite(roleId),developmentGroupIds:[source.sourceGroupId],developmentSessionIds:[reflection.sessionId]});
 return{mode:'synthetic-reflection-and-policy-validation',liveModelCalls:0,reflection,evaluation};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const role of ['java-backend','web-frontend']as const)console.log(JSON.stringify(await runReflectionDemo(role),null,2));
}
