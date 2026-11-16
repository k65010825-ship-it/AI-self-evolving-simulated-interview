import {test,expect} from 'bun:test';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createLocalHost} from '../apps/agent/src/local/host.ts';
import {Database} from 'bun:sqlite';
test('two-role local host commits sessions and memory, restarts and replays without an API or model network',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-host-'));let host=await createLocalHost({dataDir:root,assetsRoot:process.cwd()});
 try{for(const roleId of ['java-backend','web-frontend'] as const){
  const c={operationId:'create-'+roleId,roleId,goal:'离线练习',durationMinutes:20};const created=host.command('session.create',c);await host.wait(created.jobId);expect(host.job(created.jobId)).toMatchObject({status:'completed'});
  expect(()=>host.command('session.create',{...c,operationId:'overlap-'+roleId})).toThrow('ROLE_SESSION_ACTIVE');
  const planned=host.command('session.nextQuestion',{operationId:'plan-'+roleId,sessionId:created.sessionId,expectedRevision:0});await host.wait(planned.jobId);
  expect(host.job(planned.jobId)).toMatchObject({status:'completed'});
  expect(host.session(created.sessionId)).toMatchObject({phase:'awaiting_answer'});const answered=host.command('session.answer',{operationId:'answer-'+roleId,sessionId:created.sessionId,expectedRevision:1,text:'我会明确边界，并用重复实验验证结果。'});await host.wait(answered.jobId);
  const done=host.command('session.complete',{operationId:'finish-'+roleId,sessionId:created.sessionId,expectedRevision:2});await host.wait(done.jobId);expect(host.job(done.jobId).status).toBe('completed');expect(host.memory(roleId).version).toBe(1);
  expect((host.session(created.sessionId).report as {answers?:unknown[]}|null)?.answers?.length).toBe(1);
  expect(host.command('session.create',c)).toEqual(created);expect(()=>host.command('session.create',{...c,goal:'不同'})).toThrow('VERSION_CONFLICT');
 }
 await host.close();host=await createLocalHost({dataDir:root,assetsRoot:process.cwd()});expect(host.list().length).toBe(2);
 for(const roleId of ['java-backend','web-frontend'] as const){expect(host.memory(roleId).version).toBe(1);const c=host.command('session.create',{operationId:'next-'+roleId,roleId,goal:'下一场',durationMinutes:20});await host.wait(c.jobId);expect(host.session(c.sessionId).priorEvidenceCount).toBeGreaterThan(0);}
 expect(host.status().liveModelCalls).toBe(0);expect(host.events(host.listJobs()[0]!.jobId,0).length).toBeGreaterThan(0);
 expect(()=>host.command('session.create',{operationId:'forged',userId:'other',roleId:'java-backend',goal:'x',durationMinutes:20})).toThrow('VALIDATION_ERROR');
 }finally{await host.close();await rm(root,{recursive:true,force:true});}
},30000);
test('a staged crash snapshot commits its durable candidate on restart without creating another executor',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-cut-'));let host=await createLocalHost({dataDir:root,assetsRoot:process.cwd()});
 try{const c=host.command('session.create',{operationId:'cut',roleId:'java-backend',goal:'恢复',durationMinutes:20});await host.wait(c.jobId);await host.close();
  // Reconstruct the durable cut between candidate checkpoint and formal commit. This is a staged fault, not an OS crash claim.
  const db=new Database(join(root,'agent','profiles','default','profile.sqlite'));db.transaction(()=>{
   db.query('UPDATE local_sessions SET workflow=NULL,storage_version=-1 WHERE session_id=?').run(c.sessionId);
   db.query("UPDATE local_jobs SET status='running',receipt=NULL WHERE job_id=?").run(c.jobId);
   db.query('DELETE FROM local_events WHERE job_id=? AND seq=(SELECT MAX(seq) FROM local_events WHERE job_id=?)').run(c.jobId,c.jobId);
  }).immediate();db.close();
  host=await createLocalHost({dataDir:root,assetsRoot:process.cwd()});expect(host.job(c.jobId).status).toBe('completed');expect(host.session(c.sessionId).revision).toBe(0);expect(host.status().executionStarts).toBe(0);
  const cancelled=host.command('session.create',{operationId:'cancel',roleId:'web-frontend',goal:'取消',durationMinutes:20});expect(host.cancel(cancelled.jobId).status).toBe('cancelled');await host.wait(cancelled.jobId);expect(host.status().executionStarts).toBe(0);
 }finally{await host.close();await rm(root,{recursive:true,force:true});}
},15000);
test('old sessions are discoverable by page and cancelled creates expose their durable job',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-pages-'));let host=await createLocalHost({dataDir:root,assetsRoot:process.cwd()});
 try{const c=host.command('session.create',{operationId:'abort',roleId:'java-backend',goal:'取消',durationMinutes:20});host.cancel(c.jobId);expect(host.session(c.sessionId).lastOperation?.jobId).toBe(c.jobId);expect(host.session(c.sessionId).phase).toBe('cancelled');await host.close();
  const db=new Database(join(root,'agent','profiles','default','profile.sqlite'));db.transaction(()=>{for(let i=0;i<101;i++)db.query('INSERT INTO local_sessions VALUES(?,?,?,?,?,?)').run('page-'+i,'web-frontend',-1,null,i,Date.now()+100000);}).immediate();db.close();
  host=await createLocalHost({dataDir:root,assetsRoot:process.cwd()});expect(host.list(0,100)).toHaveLength(100);expect(host.list(100,100)).toHaveLength(2);expect(()=>host.list(-1,100)).toThrow('VALIDATION_ERROR');
 }finally{await host.close();await rm(root,{recursive:true,force:true});}
});
