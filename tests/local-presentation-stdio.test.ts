import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {spawnLocalAgent} from '../packages/local-agent-client/src/index.ts';

test('typed SDK exposes committed answer/report pages, summary lists and restart reads without new work',async()=>{
 const data=await mkdtemp(join(tmpdir(),'presentation-')),options={executable:process.execPath,entry:resolve('apps/agent/src/local/index.ts'),dataDir:data,assetsRoot:process.cwd(),cwd:tmpdir()};
 let client=await spawnLocalAgent(options);
 try{await client.request('runtime.initialize',{});
  for(const roleId of ['java-backend','web-frontend'] as const){
   const created=await client.request('session.create',{operationId:'create-'+roleId,roleId,goal:'read-only view',durationMinutes:20}) as {sessionId:string;jobId:string};await client.waitForJob(created.jobId);
   const initial=await client.getSession(created.sessionId);expect(initial).toMatchObject({presentationVersion:1,viewKind:'full',submittedCount:0,clarification:null});expect(await client.getReport(created.sessionId)).toBeNull();
   const plan=await client.request('session.nextQuestion',{sessionId:created.sessionId,operationId:'plan-'+roleId,expectedRevision:initial.revision}) as {jobId:string};await client.waitForJob(plan.jobId);
   const current=await client.getSession(created.sessionId);const a=await client.request('session.answer',{sessionId:created.sessionId,operationId:'answer-'+roleId,expectedRevision:current.revision,text:'我会明确边界，再用可重复实验验证。'}) as {jobId:string};await client.waitForJob(a.jobId);
   const answered=await client.getSession(created.sessionId);expect(answered.lastAnswer?.status).toBe('scored');
   const page=await client.getAnswerPage(created.sessionId,{expectedRevision:answered.revision});expect(page.total).toBe(1);
   const conflict=await client.getAnswerPage(created.sessionId,{expectedRevision:0}).then(()=>null,error=>(error as {code:string}).code);expect(conflict).toBe('VERSION_CONFLICT');
   const finish=await client.request('session.complete',{sessionId:created.sessionId,operationId:'close-'+roleId,expectedRevision:answered.revision}) as {jobId:string};await client.waitForJob(finish.jobId);
   const report=await client.getReport(created.sessionId);expect(report?.coverage.totalAnswers).toBe(1);expect(report?.answerPage.total).toBe(1);
  }
  const list=await client.listSessions();expect(list).toHaveLength(2);expect(list.every(s=>s.viewKind==='summary'&&s.report===null&&s.lastAnswer===null&&s.hasReport)).toBe(true);
  await client.close();client=await spawnLocalAgent(options);await client.request('runtime.initialize',{});
  for(const s of await client.listSessions()){expect((await client.getAnswerPage(s.sessionId)).total).toBe(1);expect(await client.getReport(s.sessionId)).not.toBeNull();}
  expect(await client.request('runtime.status',{})).toMatchObject({executionStarts:0,modelHttpAttempts:0});
 }finally{await client.close();await rm(data,{recursive:true,force:true});}
},30000);



test('typed SDK rejects malformed views without exposing their raw data',async()=>{
 const {writeFile}=await import('node:fs/promises');const dir=await mkdtemp(join(tmpdir(),'bad-presentation-'));const entry=join(dir,'fixture.ts');
 await writeFile(entry,`for await(const chunk of console){const r=JSON.parse(chunk);console.log(JSON.stringify({protocolVersion:1,type:'response',id:r.id,ok:true,result:r.method==='runtime.initialize'?{capabilities:[]}:r.method==='runtime.shutdown'?{stopped:true}:{privateRaw:'must-not-leak'}}));if(r.method==='runtime.shutdown')break;}`);
 const c=await spawnLocalAgent({executable:process.execPath,entry,dataDir:join(dir,'user'),assetsRoot:process.cwd(),cwd:tmpdir()});
 try{await c.request('runtime.initialize',{});const error=await c.getSession('s').then(()=>null,e=>e as Error);expect(error?.message).toBe('LOCAL_RESPONSE_INVALID');expect(String(error)).not.toContain('must-not-leak');}
 finally{await c.close();await rm(dir,{recursive:true,force:true});}
},10000);
