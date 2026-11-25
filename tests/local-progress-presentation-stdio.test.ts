import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnLocalAgent} from '../packages/local-agent-client/src/index.ts';
import {bindLocalProcess} from '../packages/local-agent-client/src/connection.ts';
import {LOCAL_PROGRESS_VIEWS_CAPABILITY} from '../packages/contracts/src/local-presentation.ts';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';

test('stdio progress views expose profile, practice recommendations, and reflections across restart without extra runs',async()=>{
 const data=await mkdtemp(join(tmpdir(),'progress-stdio-'));
 let client=await spawnLocalAgent({executable:process.execPath,entry:resolve('apps/agent/src/local/index.ts'),dataDir:data,assetsRoot:process.cwd(),cwd:tmpdir()});
 try{
  const init=await client.request('runtime.initialize',{}) as {capabilities:string[]};
  expect(init.capabilities).toContain(LOCAL_PROGRESS_VIEWS_CAPABILITY);
  const c=await client.createSession({operationId:'c1',roleId:'web-frontend',goal:'全面复盘',durationMinutes:20,practiceMode:'broad-coverage'});
  await client.waitForJob(c.jobId);
  const q=await client.request('session.nextQuestion',{operationId:'q1',sessionId:c.sessionId,expectedRevision:0}) as {jobId:string};
  await client.waitForJob(q.jobId);
  const a=await client.request('session.answer',{operationId:'a1',sessionId:c.sessionId,expectedRevision:1,text:'我会先说明状态归属、取消旧请求与边界条件，再说明如何验证。'}) as {jobId:string};
  await client.waitForJob(a.jobId);
  const f=await client.request('session.complete',{operationId:'f1',sessionId:c.sessionId,expectedRevision:2}) as {jobId:string};
  await client.waitForJob(f.jobId);

  const statusBefore=await client.request('runtime.status',{}) as {executionStarts:number;modelHttpAttempts:number};
  const profile=await client.getProfile({roleId:'web-frontend'});
  const rec=await client.getPracticeRecommendations({roleId:'web-frontend',maxGoals:3});
  const refl=await client.listReflections({roleId:'web-frontend'});
  const statusAfter=await client.request('runtime.status',{}) as {executionStarts:number;modelHttpAttempts:number};
  expect(statusAfter).toEqual(statusBefore);
  expect(profile.memoryVersion).toBe(1);
  expect(rec.learningProgressAvailable).toBe(false);
  expect(refl.deploymentStatus).toBe('not_published');
  expect(refl.items).toHaveLength(1);

  await client.close();
  client=await spawnLocalAgent({executable:process.execPath,entry:resolve('apps/agent/src/local/index.ts'),dataDir:data,assetsRoot:process.cwd(),cwd:tmpdir()});
  await client.request('runtime.initialize',{});
  expect((await client.getProfile({roleId:'web-frontend'})).sourceDigest).toBe(profile.sourceDigest);
  expect((await client.listReflections({roleId:'web-frontend'})).sourceDigest).toBe(refl.sourceDigest);
 }finally{await client.close();await rm(data,{recursive:true,force:true});}
},30000);

test('SDK progress view helpers reject malformed responses with LOCAL_RESPONSE_INVALID',async()=>{
 const stdin=new PassThrough(),stdout=new PassThrough(),stderr=new PassThrough();
 const child=Object.assign(new EventEmitter(),{stdin,stdout,stderr,kill:()=>true}) as never;
 stdin.on('data',chunk=>{
  const req=JSON.parse(chunk.toString().trim());
  stdout.write(JSON.stringify({protocolVersion:1,type:'response',id:req.id,ok:true,result:{bad:true}})+'\n');
 });
 const client=bindLocalProcess(child,{timeoutMs:1000});
 await expect(client.getProfile({roleId:'java-backend'})).rejects.toThrow('LOCAL_RESPONSE_INVALID');
 await expect(client.getPracticeRecommendations({roleId:'java-backend'})).rejects.toThrow('LOCAL_RESPONSE_INVALID');
 await expect(client.listReflections({roleId:'java-backend'})).rejects.toThrow('LOCAL_RESPONSE_INVALID');
});
