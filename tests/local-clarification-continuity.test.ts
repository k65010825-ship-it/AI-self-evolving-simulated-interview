import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {Database} from 'bun:sqlite';
import {spawnLocalAgent} from '../packages/local-agent-client/src/index.ts';
type Job={jobId:string;sessionId:string};
for(const roleId of ['java-backend','web-frontend'] as const)for(const outcome of ['scored','abstained'] as const){
 test(`${roleId}: ${outcome} clarification survives stdio restart, rejects prefix edits and replays exactly once`,async()=>{
  const data=await mkdtemp(join(tmpdir(),'clarification-continuity-'));
  const options={executable:process.execPath,entry:resolve('apps/agent/src/local/index.ts'),dataDir:data,assetsRoot:process.cwd(),cwd:tmpdir()};
  let client=await spawnLocalAgent(options);
  try{
   await client.request('runtime.initialize',{});
   const c=await client.request('session.create',{operationId:'create',roleId,goal:'continuity',durationMinutes:20}) as Job;await client.waitForJob(c.jobId);
   const p=await client.request('session.nextQuestion',{sessionId:c.sessionId,operationId:'plan',expectedRevision:0}) as Job;expect(await client.waitForJob(p.jobId)).toHaveProperty('status','completed');
   const first=await client.request('session.answer',{sessionId:c.sessionId,operationId:'first',expectedRevision:1,text:'不懂'}) as Job;
   expect(await client.waitForJob(first.jobId)).toHaveProperty('status','completed');
   expect(await client.getSession(c.sessionId)).toMatchObject({revision:2,needsClarification:true,clarification:{previousText:'不懂'},lastAnswer:{status:'needs_clarification',normalizedScore:null}});
   await client.close();client=await spawnLocalAgent(options);await client.request('runtime.initialize',{});
   expect(await client.request('runtime.status',{})).toMatchObject({executionStarts:0,modelHttpAttempts:0});
   const bad=await client.request('session.answer',{sessionId:c.sessionId,operationId:'bad-prefix',expectedRevision:2,text:'换掉原回答'}) as Job;
   expect(await client.waitForJob(bad.jobId)).toMatchObject({status:'failed',errorCode:'VERSION_CONFLICT'});
   expect(await client.getSession(c.sessionId)).toHaveProperty('revision',2);
   const command={sessionId:c.sessionId,operationId:'continuation',expectedRevision:2,text:outcome==='scored'?'不懂；补充：我会明确边界并验证失败路径。':'不懂。'};
   const [next,replay]=await Promise.all([client.request('session.answer',command),client.request('session.answer',command)]) as [Job,Job];
   expect(replay).toEqual(next);
   expect(await client.waitForJob(next.jobId)).toMatchObject({status:'completed',errorCode:null});
   const s=await client.getSession(c.sessionId);
   expect(s).toMatchObject({revision:3,needsClarification:false,submittedCount:1,lastAnswer:{status:outcome}});
   expect(s.lastAnswer?.normalizedScore).toBe(outcome==='scored'?.5:null);
   expect(s).toMatchObject({scoredCount:outcome==='scored'?1:0,unscoredCount:outcome==='scored'?0:1});
   const finish=await client.request('session.complete',{sessionId:c.sessionId,operationId:'finish',expectedRevision:3}) as Job;expect(await client.waitForJob(finish.jobId)).toHaveProperty('status','completed');
   const report=await client.getReport(c.sessionId);expect(report?.coverage).toMatchObject({totalAnswers:1,scoredAnswers:outcome==='scored'?1:0,unscoredAnswers:outcome==='scored'?0:1});
   const memory=await client.request('memory.get',{roleId}) as {version:number};expect(memory.version).toBe(outcome==='scored'?1:0);
   await client.close();client=await spawnLocalAgent(options);await client.request('runtime.initialize',{});
   expect(await client.request('session.answer',command)).toEqual(next);
   expect(await client.waitForJob(next.jobId)).toHaveProperty('status','completed');
   const collision=await client.request('session.answer',{...command,text:command.text+'changed'}).then(()=>null,e=>(e as {code:string}).code);expect(collision).toBe('VERSION_CONFLICT');
   expect(await client.request('runtime.status',{})).toMatchObject({executionStarts:0,modelHttpAttempts:0});
   await client.close();
   const db=new Database(join(data,'agent','profiles','default','profile.sqlite'),{readonly:true});
   try{
    const rows=db.query("SELECT request FROM local_jobs WHERE operation_id IN ('first','continuation') ORDER BY created_at,rowid").all() as {request:string}[];
    const requests=rows.map(r=>JSON.parse(r.request)),a=requests[0].job.operation.command,b=requests[1].job.operation.command;
    expect(a.observationId).toBe(b.observationId);expect(a.answer.id).not.toBe(b.answer.id);expect(a.context.runId).not.toBe(b.context.runId);
    expect(db.query("SELECT COUNT(*) AS n FROM local_jobs WHERE operation_id='continuation'").get()).toEqual({n:1});
   }finally{db.close();}
  }finally{await client.close();await rm(data,{recursive:true,force:true});}
 },30000);
}
