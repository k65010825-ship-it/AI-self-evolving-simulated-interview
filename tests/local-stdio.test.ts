import {test,expect} from 'bun:test';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {spawnLocalAgent} from '../packages/local-agent-client/src/index.ts';
import {spawn} from 'node:child_process';
test('stdio child works from another cwd, returns only versioned frames and restores local history',async()=>{
 const data=await mkdtemp(join(tmpdir(),'本地 agent 空格-')),entry=resolve('apps/agent/src/local/index.ts'),assetsRoot=process.cwd();
 let client=await spawnLocalAgent({executable:process.execPath,entry,dataDir:data,assetsRoot,cwd:tmpdir()});
 try{const ready=await client.request('runtime.initialize',{});expect(ready).toMatchObject({protocolVersion:1,mode:'local-runtime'});
  const c=await client.request('session.create',{operationId:'stdio-create',roleId:'java-backend',goal:'本机练习',durationMinutes:20}) as {jobId:string;sessionId:string};
  await client.waitForJob(c.jobId);expect(await client.request('session.get',{sessionId:c.sessionId})).toMatchObject({revision:0});
  expect(await client.request('hint.status',{sessionId:c.sessionId})).toMatchObject({available:false,reason:'HINT_STORAGE_UNAVAILABLE'});
  let hintError='';try{await client.request('hint.request',{operationId:'hint',sessionId:c.sessionId,issueId:'a'.repeat(64),expectedRevision:0});}catch(e){hintError=(e as Error).message;}expect(hintError).toBe('HINT_STORAGE_UNAVAILABLE');
  const events=await client.request('job.events',{jobId:c.jobId,afterSeq:0}) as unknown[];expect(events.length).toBeGreaterThan(1);
  let rejected='';try{await client.request('session.create',{operationId:'bad',userId:'forged'});}catch(e){rejected=(e as Error).message;}expect(rejected).toBe('VALIDATION_ERROR');
  await client.close();client=await spawnLocalAgent({executable:process.execPath,entry,dataDir:data,assetsRoot,cwd:tmpdir()});await client.request('runtime.initialize',{});
  expect(await client.request('session.get',{sessionId:c.sessionId})).toMatchObject({revision:0});expect(await client.request('session.create',{operationId:'stdio-create',roleId:'java-backend',goal:'本机练习',durationMinutes:20})).toEqual(c);
 }finally{await client.close();await rm(data,{recursive:true,force:true});}
},30000);
test('an unknown method fails only its request; EOF drains a real stdio process without HTTP',async()=>{
 const data=await mkdtemp(join(tmpdir(),'local-frames-'));const methods=['runtime.initialize','unknown.method','runtime.status'];
 const input=methods.map((method,i)=>JSON.stringify({protocolVersion:1,type:'request',id:'r'+i,method,params:{}})).join('\n')+'\n';
 const child=Bun.spawn([process.execPath,'--no-env-file',resolve('apps/agent/src/local/index.ts'),'--data-dir',data,'--assets-root',process.cwd()],{stdin:new Blob([input]),stdout:'pipe',stderr:'pipe'});
 try{const [stdout,_stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);const frames=stdout.trim().split('\n').map(s=>JSON.parse(s));expect(code).toBe(0);expect(frames).toHaveLength(3);expect(frames[1]).toMatchObject({id:'r1',ok:false,error:{code:'NOT_IMPLEMENTED'}});expect(frames[2]).toMatchObject({id:'r2',ok:true});
 }finally{child.kill();await child.exited;await rm(data,{recursive:true,force:true});}
},15000);
test('an unread stdout cannot retain the profile indefinitely after input EOF',async()=>{
 const data=await mkdtemp(join(tmpdir(),'local-slow-'));let input=JSON.stringify({protocolVersion:1,type:'request',id:'init',method:'runtime.initialize',params:{}})+'\n';
 for(let i=0;i<12000;i++)input+=JSON.stringify({protocolVersion:1,type:'request',id:'slow-'+i,method:'runtime.status',params:{}})+'\n';
 const child=spawn(process.execPath,['--no-env-file',resolve('apps/agent/src/local/index.ts'),'--data-dir',data,'--assets-root',process.cwd()],{windowsHide:true,stdio:['pipe','pipe','pipe']});let timer:ReturnType<typeof setTimeout>|undefined;
 child.stdin.on('error',()=>{});child.stderr.resume();child.stdout.pause();const exited=new Promise<number|null>(r=>child.once('exit',r));child.stdin.end(input);
 try{const code=await Promise.race([exited,new Promise<never>((_r,reject)=>{timer=setTimeout(()=>reject(Error('SLOW_OUTPUT_DID_NOT_CLOSE')),8000);})]);expect(code).toBe(1);
 }finally{clearTimeout(timer);child.kill('SIGKILL');await exited;child.stdout.destroy();child.stderr.destroy();await rm(data,{recursive:true,force:true});}
},10000);
