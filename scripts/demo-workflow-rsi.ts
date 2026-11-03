import{pathToFileURL}from'node:url';
import{createWorkflowRsiSource}from'../experiments/reflection/workflow-source-fixture.ts';
import{createExperimentRegistry}from'../apps/agent/src/reflection/experiment-registry.ts';
import{evaluateWorkflowRsi}from'../apps/agent/src/reflection/evaluate-workflow-rsi.ts';
import{createPolicyValidationSuite}from'../evals/policy/validation-scenarios.ts';
import{PolicyValidationSuiteSchema}from'../packages/contracts/src/reflection.ts';
import type{RoleId}from'../packages/contracts/src/tools.ts';
export async function runWorkflowRsiDemo(roleId:RoleId='java-backend'){
 const f=await createWorkflowRsiSource(roleId),source=f.workflow,now=Date.now(),experimentId=`workflow-rsi-${roleId}`;
 const registry=createExperimentRegistry({experimentId,roleId,now,baselinePolicy:source.policy});
 const input={identity:source.identity,snapshot:source,experimentId,registry,expectedRegistryVersion:0,operationId:'evaluate-closeout',
  suite:PolicyValidationSuiteSchema.parse(createPolicyValidationSuite(roleId)),developmentGroupIds:[],developmentSessionIds:[],nextSessionId:`next-offline-${roleId}`,now};
 const result=await evaluateWorkflowRsi(input);
 return{source,input,result,liveModelCalls:f.stats.liveModelCalls,sourceCatalogMode:f.sourceCatalogMode};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const role of ['java-backend','web-frontend']as const){const d=await runWorkflowRsiDemo(role);console.log(JSON.stringify({role,status:d.result.status,
  sourceCatalogMode:d.sourceCatalogMode,metric:d.result.metric,baseline:d.result.evaluation?.baseline.value,candidate:d.result.evaluation?.candidate.value,
  delta:d.result.evaluation?.delta,changes:d.result.changes,oldDepth:d.source.policy.parameters.maxFollowupDepth,
  previewDepth:d.result.nextSessionPin.policy.parameters.maxFollowupDepth,scope:d.result.scope,productionPublished:false,liveModelCalls:d.liveModelCalls},null,2));}
}
