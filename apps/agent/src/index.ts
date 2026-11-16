import { createAgentApp } from './app.ts';
import{createOfflineRunManager}from'./runtime/offline-runtime.ts';
import{createLiveRunManager}from'./runtime/live-runtime.ts';
import{readLiveServiceConfig}from'./model-access/read-live-config.ts';
import{createDurableLiveRunManager}from'./runtime/durable-runtime.ts';
import{randomUUID}from'node:crypto';
import{createServiceShutdown,bindShutdownSignals}from'./runtime/service-shutdown.ts';
const port = Number(process.env.AGENT_PORT ?? 3200);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid AGENT_PORT');
const mode=process.env.AGENT_MODE??'scaffold';
if(!['scaffold','offline-fixture','live-service'].includes(mode))throw new Error('Unsupported AGENT_MODE');
if(mode!=='scaffold'&&!/^[A-Za-z0-9_-]{32,256}$/.test(process.env.AGENT_INTERNAL_TOKEN??''))throw new Error('Set an explicit internal service token');
const planning=process.env.AGENT_PLANNING_MODE??'deterministic';
if(planning!=='deterministic'&&planning!=='pi-knowledge')throw new Error('Unsupported AGENT_PLANNING_MODE');
if(mode==='live-service'&&!process.env.AGENT_LIVE_CONFIG_PATH)throw Error('Set AGENT_LIVE_CONFIG_PATH');
if(process.env.AGENT_DURABLE_DB_PATH&&mode!=='live-service')throw Error('Durable operation storage requires live-service mode');
const liveConfig=mode==='live-service'?await readLiveServiceConfig(process.env.AGENT_LIVE_CONFIG_PATH!):undefined;
const runtime=mode==='offline-fixture'?await createOfflineRunManager({planning}):liveConfig?
 (process.env.AGENT_DURABLE_DB_PATH?createDurableLiveRunManager(liveConfig,{readCredential:name=>process.env[name]},
  {path:process.env.AGENT_DURABLE_DB_PATH,ownerId:randomUUID()}):createLiveRunManager(liveConfig,{readCredential:name=>process.env[name]})):undefined;
const app=runtime?createAgentApp({runtime,internalToken:process.env.AGENT_INTERNAL_TOKEN!,runtimeMode:mode==='live-service'?'live-runtime':'offline-runtime'}):createAgentApp();
const server=Bun.serve({ hostname: process.env.AGENT_HOST ?? '127.0.0.1', port, fetch:app.fetch });
const shutdown=createServiceShutdown({...(runtime?{runtime}:{}),stop:()=>server.stop(true)});
bindShutdownSignals(process,shutdown,result=>{console.log(JSON.stringify({event:'agent.shutdown',...result}));if(result.status==='incomplete')process.exitCode=1;},
 ()=>{console.error('AGENT_SHUTDOWN_FAILED');process.exitCode=1;});
console.log(`Agent ${mode}: http://127.0.0.1:${port}/health`);
