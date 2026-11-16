import {createPilotAgent} from './agent.ts';import {createPilotApi} from './api.ts';import type {PilotConfig} from './config.ts';
/** Integration host exposes separate HTTP services. Production entrypoints can run either process independently. */
export async function createPilotStack(config:PilotConfig,options:{readCredential?:(name:string)=>string|undefined}={}){
 let apiUrl='';const agent=await createPilotAgent(config,{apiUrl:()=>apiUrl,readCredential:options.readCredential??(name=>process.env[name])});
 const agentServer=Bun.serve({hostname:'127.0.0.1',port:config.agentPort,fetch:agent.app.fetch});
 let api:Awaited<ReturnType<typeof createPilotApi>>|undefined,apiServer:Bun.Server<undefined>|undefined;
 try{api=await createPilotApi(config,`http://127.0.0.1:${agentServer.port}`);apiServer=Bun.serve({hostname:'127.0.0.1',port:config.apiPort,fetch:api.app.fetch});apiUrl=`http://127.0.0.1:${apiServer.port}`;
  return{apiUrl,agentUrl:`http://127.0.0.1:${agentServer.port}`,api,agent,async close(){await apiServer?.stop(true);await agentServer.stop(true);api!.close();await agent.close();}};
 }catch(e){await apiServer?.stop(true);await agentServer.stop(true);api?.close();await agent.close();throw e;}
}
