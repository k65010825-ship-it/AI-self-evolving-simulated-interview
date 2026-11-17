import {test,expect} from 'bun:test';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {Database} from 'bun:sqlite';
import {createLocalHost} from '../apps/agent/src/local/host.ts';
test('failed startup closes its own profile lease without erasing unknown evidence',async()=>{
 const data=await mkdtemp(join(tmpdir(),'failed-local-init-')),options={dataDir:data,assetsRoot:process.cwd(),now:()=>1000};let h=await createLocalHost(options);
 const path=join(data,'agent','profiles','default','profile.sqlite');
 try{
  await h.close();let db=new Database(path);db.query('INSERT INTO local_model_checkpoints VALUES(?,?,?,?,?,?,?)').run('bad','bad','a','s','g','{}','{}');db.query('INSERT INTO local_budget VALUES(?,?,?,?,?,?,?)').run('legacy','old-job','unknown','llm',100,null,null);db.close();
  for(let i=0;i<2;i++){
   const error=await createLocalHost(options).then(()=>null,e=>e as Error);expect(error).not.toBeNull();
   db=new Database(path,{readonly:true});try{
    expect(db.query('SELECT lease_until FROM local_control WHERE id=1').get()).toEqual({lease_until:0});
    expect(db.query("SELECT status,reserved_cost FROM local_budget WHERE attempt_id='legacy'").get()).toEqual({status:'unknown',reserved_cost:100});
    expect(db.query("SELECT snapshot FROM local_model_checkpoints WHERE run_id='bad'").get()).toEqual({snapshot:'{}'});
   }finally{db.close();}
  }
  // Explicit repair of only the deliberately invalid fixture row; never settle or delete unknown costs.
  db=new Database(path);db.query("DELETE FROM local_model_checkpoints WHERE run_id='bad'").run();db.close();h=await createLocalHost(options);
  expect(h.status()).toMatchObject({executionStarts:0,modelHttpAttempts:0,unknownAttempts:1});
 }finally{await h.close();Bun.gc(true);await rm(data,{recursive:true,force:true});}
});
for(const roleId of ['java-backend','web-frontend'] as const)test(`${roleId}: expired durable candidate retains a specific failure and never re-executes`,async()=>{
 const data=await mkdtemp(join(tmpdir(),'expired-local-cut-'));let now=Date.now();const options={dataDir:data,assetsRoot:process.cwd(),now:()=>now};let h=await createLocalHost(options);
 try{
  const command={operationId:'create',roleId,goal:'expiry cut',durationMinutes:20};const c=h.command('session.create',command);await h.wait(c.jobId);expect(h.job(c.jobId).status).toBe('completed');await h.close();
  const db=new Database(join(data,'agent','profiles','default','profile.sqlite'));let snapshot:string;
  try{snapshot=(db.query('SELECT snapshot FROM local_jobs WHERE job_id=?').get(c.jobId) as {snapshot:string}).snapshot;db.transaction(()=>{
   db.query('UPDATE local_sessions SET workflow=NULL,storage_version=-1 WHERE session_id=?').run(c.sessionId);
   db.query("UPDATE local_jobs SET status='running',receipt=NULL WHERE job_id=?").run(c.jobId);
   db.query('DELETE FROM local_events WHERE job_id=? AND seq=(SELECT MAX(seq) FROM local_events WHERE job_id=?)').run(c.jobId,c.jobId);
  }).immediate();}finally{db.close();}
  now+=31000;h=await createLocalHost(options);
  expect(h.job(c.jobId)).toMatchObject({status:'interrupted',errorCode:'COMMIT_LEASE_EXPIRED'});expect(h.command('session.create',command)).toEqual(c);
  expect(h.status()).toMatchObject({executionStarts:0,modelHttpAttempts:0});expect(h.memory(roleId).version).toBe(0);expect(h.session(c.sessionId).revision).toBe(-1);
  const after=new Database(join(data,'agent','profiles','default','profile.sqlite'),{readonly:true});try{expect(after.query('SELECT snapshot,receipt FROM local_jobs WHERE job_id=?').get(c.jobId)).toEqual({snapshot:snapshot!,receipt:null});}finally{after.close();}
 }finally{await h.close();await rm(data,{recursive:true,force:true});}
});
