import {test,expect} from 'bun:test';import {mkdtemp,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {spawnLocalAgent} from '../packages/local-agent-client/src/index.ts';
test('real startup failure retains whitelisted phase/cause and exit code without raw dependency stderr',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'process-failure-'));const client=await spawnLocalAgent({executable:process.execPath,entry:resolve('apps/agent/src/local/index.ts'),dataDir,assetsRoot:join(dataDir,'missing-assets'),cwd:tmpdir()});
 try{const error=await client.request('runtime.initialize',{}).then(()=>null,e=>e);expect(error.message).toBe('LOCAL_PROCESS_EXITED');
  expect(error.diagnostic.lastRuntime).toMatchObject({stage:'startup',code:'STARTUP_FAILED'});
  const events=client.diagnostics().events;expect(events.some(e=>e.code==='BOOTSTRAP_STARTED')).toBe(true);
  expect(events.find(e=>e.code==='STARTUP_FAILED')).toMatchObject({stage:'startup',failureCode:'LOCAL_PATH_INVALID'});
  expect(events.find(e=>e.code==='PROCESS_CLOSED')).toMatchObject({exitCode:1});expect(JSON.stringify(events)).not.toContain(dataDir);
 }catch(error){console.error(JSON.stringify(client.diagnostics()));throw error;}finally{await client.close();await rm(dataDir,{recursive:true,force:true});}
},15000);
test('real stdio startup and graceful shutdown expose safe diagnostics and observer errors cannot fail transport',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'process-close-'));const client=await spawnLocalAgent({executable:process.execPath,entry:resolve('apps/agent/src/local/index.ts'),dataDir,assetsRoot:process.cwd(),cwd:tmpdir(),onDiagnostic:()=>{throw Error('observer');}});
 try{await client.request('runtime.initialize',{});await client.close();
  const events=client.diagnostics().events;for(const code of ['HOST_READY','SHUTDOWN_COMPLETED','PROCESS_CLOSED'])expect(events.some(e=>e.code===code)).toBe(true);
  expect(events.find(e=>e.code==='PROCESS_CLOSED')).toMatchObject({exitCode:0});
 }catch(error){console.error(JSON.stringify(client.diagnostics()));throw error;}finally{await client.close();await rm(dataDir,{recursive:true,force:true});}
},15000);
