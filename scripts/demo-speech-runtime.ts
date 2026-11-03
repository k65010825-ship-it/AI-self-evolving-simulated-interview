import { pathToFileURL } from 'node:url';
import { runAgentRuntimeDemo } from './demo-agent-runtime.ts';
import type { RoleId } from '../packages/contracts/src/tools.ts';
export const runSpeechRuntimeDemo=(roleId:RoleId='java-backend')=>runAgentRuntimeDemo(roleId,{speech:true});
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  for(const roleId of ['java-backend','web-frontend']as const)console.log(JSON.stringify(await runSpeechRuntimeDemo(roleId),null,2));
}
