import{pathToFileURL}from'node:url';
import{runAgentRuntimeDemo}from'./demo-agent-runtime.ts';
import type{RoleId}from'../packages/contracts/src/tools.ts';
export const runPlannerRuntimeDemo=(roleId:RoleId='java-backend')=>runAgentRuntimeDemo(roleId,{planner:true});
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const role of ['java-backend','web-frontend']as const)console.log(JSON.stringify(await runPlannerRuntimeDemo(role),null,2));
}
