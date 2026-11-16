import { test,expect } from 'bun:test';
import { readLiveServiceConfig } from '../apps/agent/src/model-access/read-live-config.ts';
import { createLiveRunManager } from '../apps/agent/src/runtime/live-runtime.ts';
import { createAgentApp } from '../apps/agent/src/app.ts';
import config from '../apps/agent/src/model-access/bailian.example.json' with {type:'json'};
test('operator JSON is default-off and live health means configured, not credential or provider availability',async()=>{
 const parsed=await readLiveServiceConfig('apps/agent/src/model-access/bailian.example.json');expect(parsed.authorization.enabled).toBe(false);expect(parsed.authorization.operatorApproved).toBe(false);
 let reads=0;const r=createLiveRunManager({...config,authorization:{...config.authorization,enabled:true,operatorApproved:true,expiresAt:Date.now()+60000}},
  {readCredential:()=>{reads++;return undefined;},fetch:async()=>{throw Error('Must not contact provider');}});
 try{
  const app=createAgentApp({runtime:r,internalToken:'live_entry_service_token_1234567890',runtimeMode:'live-runtime'});
  const health=await (await app.request('/health')).json();expect(health.stage).toBe('live-runtime');expect(health.liveModelConfigured).toBe(true);expect(reads).toBe(0);
 }finally{r.dispose();}
});
