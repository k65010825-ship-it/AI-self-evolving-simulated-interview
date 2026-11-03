import{pathToFileURL}from'node:url';
import{runWorkflowHttpDemo}from'./demo-workflow-http.ts';
import type{RoleId}from'../packages/contracts/src/tools.ts';
export const runAgentClientDemo=(roleId:RoleId='java-backend',transport:'tcp'|'in-process'='tcp')=>runWorkflowHttpDemo(roleId,transport,{sdk:true});
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const roleId of ['java-backend','web-frontend']as const)console.log(JSON.stringify(await runAgentClientDemo(roleId),null,2));
}
