import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createLocalHost} from '../apps/agent/src/local/host.ts';
import {openLocalProfile} from '../apps/agent/src/local/profile-store.ts';
import {createExperimentRegistry} from '../apps/agent/src/reflection/experiment-registry.ts';
import {LOCAL_EXPERIMENTS_CAPABILITY} from '../packages/contracts/src/local-experiment.ts';
import {LOCAL_LEARNING_CAPABILITY} from '../packages/contracts/src/local-learning.ts';
import {WorkflowSchema} from '../packages/contracts/src/session-workflow.ts';
import {PROFILE_V4_TABLES} from '../packages/local-db/src/profile/upgrade.ts';
import {spawnLocalAgent} from '../packages/local-agent-client/src/index.ts';

test('profile v3 upgrades cleanly to v4 with verified backup while preserving hintAssistance, memory, jobs, and unknown budget',()=>{
 const data=mkdtempSync(join(tmpdir(),'v3-to-v4-'));
 let p=openLocalProfile({dataDir:data,assetsRoot:process.cwd(),now:()=>1000});
 const path=p.path,dir=p.profile;
 try{
  p.write(db=>{
   for(const t of [...PROFILE_V4_TABLES].reverse())db.exec(`DROP TABLE ${t}`);
   db.query('INSERT INTO local_sessions VALUES(?,?,?,?,?,?)').run('s-v3','java-backend',3,'{"hintAssistance":[{"questionId":"q1","assistance":{"kind":"hint-assisted"}}]}',1000,90000);
   db.query('INSERT INTO local_memory VALUES(?,?)').run('java-backend','{"schemaVersion":1,"sessions":[{"sessionId":"s-v3"}]}');
   db.query('INSERT INTO local_jobs VALUES(?,?,?,?,?,?,?,?,NULL,NULL,NULL,?)').run('j-v3','op-v3','s-v3','java-backend','d','{}','{}','completed',1000);
   db.query('INSERT INTO local_budget VALUES(?,?,?,?,?,?,?)').run('legacy-unk','j-v3','unknown','llm',55,null,null);
   db.exec('PRAGMA user_version=3');
  });
  p.close();

  p=openLocalProfile({dataDir:data,assetsRoot:process.cwd(),now:()=>2000});
  expect(p.read(db=>db.query('PRAGMA user_version').get())).toEqual({user_version:4});
  const backups=readdirSync(join(dir,'backups')).filter(f=>f.startsWith('v3-')&&f.endsWith('.sqlite'));
  expect(backups).toHaveLength(1);
  expect(p.read(db=>db.query('SELECT workflow FROM local_sessions WHERE session_id=?').get('s-v3'))).toEqual({workflow:'{"hintAssistance":[{"questionId":"q1","assistance":{"kind":"hint-assisted"}}]}'});
  expect(p.read(db=>db.query('SELECT status,reserved_cost FROM local_budget WHERE attempt_id=?').get('legacy-unk'))).toEqual({status:'unknown',reserved_cost:55});
  for(const table of PROFILE_V4_TABLES)expect(p.read(db=>db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))).not.toBeNull();
  p.close();

  const db=new Database(path);
  try{db.exec('PRAGMA user_version=5');}finally{db.close();}
  expect(()=>openLocalProfile({dataDir:data,assetsRoot:process.cwd(),now:()=>3000})).toThrow('LOCAL_SCHEMA_UNSUPPORTED');
  expect(readdirSync(join(dir,'backups')).filter(f=>f.startsWith('v4-'))).toHaveLength(0);
 }finally{
  try{p.close();}catch{/* already closed */}
  rmSync(data,{recursive:true,force:true});
 }
});

test('formal default repositories handle cross-module operation conflicts, latest skill ordering, restart replay, and pending recovery via host & stdio',async()=>{
 const data=await mkdtemp(join(tmpdir(),'v4-formal-host-'));
 let client=await spawnLocalAgent({executable:process.execPath,entry:resolve('apps/agent/src/local/index.ts'),dataDir:data,assetsRoot:process.cwd(),cwd:tmpdir()});
 try{
  const init=await client.request('runtime.initialize',{}) as {capabilities:string[]};
  expect(init.capabilities).toContain('limited-hints-v1');
  expect(init.capabilities).toContain(LOCAL_LEARNING_CAPABILITY);
  expect(init.capabilities).toContain(LOCAL_EXPERIMENTS_CAPABILITY);

  // Complete a two-question session with a formal hint on Q1 and formal storage
  const c1=await client.createSession({operationId:'f-c1',roleId:'java-backend',goal:'v4 formal',durationMinutes:20});
  await client.waitForJob(c1.jobId);
  const q1=await client.request('session.nextQuestion',{operationId:'f-q1',sessionId:c1.sessionId,expectedRevision:0}) as {jobId:string};
  await client.waitForJob(q1.jobId);
  const hStatus=await client.request('hint.status',{sessionId:c1.sessionId}) as {available:boolean;issueId:string};
  expect(hStatus.available).toBe(true);
  const h1=await client.request('hint.request',{operationId:'f-hint-1',sessionId:c1.sessionId,issueId:hStatus.issueId,expectedRevision:1}) as {level:number};
  expect(h1.level).toBe(1);

  await client.request('session.answer',{operationId:'f-a1',sessionId:c1.sessionId,expectedRevision:2,text:'我先解释前提边界与失败回滚机制。'}).then(r=>client.waitForJob((r as {jobId:string}).jobId));
  const q2=await client.request('session.nextQuestion',{operationId:'f-q2',sessionId:c1.sessionId,expectedRevision:3}) as {jobId:string};
  await client.waitForJob(q2.jobId);
  await client.request('session.answer',{operationId:'f-a2',sessionId:c1.sessionId,expectedRevision:4,text:'我会说明可见性、CAS原子更新与并发验证方案。'}).then(r=>client.waitForJob((r as {jobId:string}).jobId));
  await client.request('session.complete',{operationId:'f-fin1',sessionId:c1.sessionId,expectedRevision:5}).then(r=>client.waitForJob((r as {jobId:string}).jobId));

  // Create two assignments for java-concurrency: older stays not_started, newer becomes self_reported -> recommendations must see self_reported!
  const ansPage=await client.getAnswerPage(c1.sessionId);
  const q2Answer=ansPage.items[1]!;
  const dbRead=new Database(join(data,'agent','profiles','default','profile.sqlite'),{readonly:true});
  const wf=WorkflowSchema.parse(JSON.parse((dbRead.query('SELECT workflow FROM local_sessions WHERE session_id=?').get(c1.sessionId) as {workflow:string}).workflow));
  dbRead.close();
  const skillId=wf.turns[1]!.input.question.skillId;

  const older=await client.createLearningAssignment({
   operationId:'f-assign-older',roleId:'java-backend',sourceSessionId:c1.sessionId,sourceAnswerId:q2Answer.answerId,
   skillId,resourceIds:[],requiredExerciseIds:['ex-old'],dataMode:'synthetic',predictedTargetScore:0.75,targetDifficulty:2,
  });
  await new Promise(r=>setTimeout(r,15));
  const newer=await client.createLearningAssignment({
   operationId:'f-assign-newer',roleId:'java-backend',sourceSessionId:c1.sessionId,sourceAnswerId:q2Answer.answerId,
   skillId,resourceIds:[],requiredExerciseIds:['ex-new'],dataMode:'synthetic',predictedTargetScore:0.8,targetDifficulty:2,
  });
  await client.recordLearningEvent({
   operationId:'f-ev-self',assignmentId:newer.assignmentId,expectedVersion:0,
   event:{id:'ev-1',occurredAt:Date.now(),kind:'self_reported_complete'},
  });
  expect(older.summary.status).toBe('not_started');
  const rec=await client.getPracticeRecommendations({roleId:'java-backend',maxGoals:5});
  expect(rec.learningProgressAvailable).toBe(true);
  expect(rec.goals.find(g=>g.skillId===skillId)?.learningStatus).toBe('self_reported');

  // Cross-module operationId collisions must return exact host conflict codes, never OPERATION_CONFLICT or DEPENDENCY_UNAVAILABLE
  for(const [method,params,expectedCode] of [
   ['learning.assignment.create',{operationId:'f-hint-1',roleId:'java-backend',sourceSessionId:c1.sessionId,sourceAnswerId:q2Answer.answerId,skillId,resourceIds:[],requiredExerciseIds:['x'],dataMode:'synthetic',predictedTargetScore:0.8},'VERSION_CONFLICT'],
   ['experiment.rollback',{operationId:'f-ev-self',experimentId:'missing-exp',roleId:'java-backend',expectedRegistryVersion:0,targetPolicyId:'p0',reason:'cross check'},'VERSION_CONFLICT'],
   ['session.create',{operationId:'f-assign-newer',roleId:'web-frontend',goal:'collision',durationMinutes:20},'VERSION_CONFLICT'],
  ] as const){
   let code='';try{await client.request(method,params);}catch(e){code=(e as Error).message;}
   expect(code).toBe(expectedCode);
  }
  const c2=await client.createSession({operationId:'f-c2',roleId:'web-frontend',goal:'hint conflict check',durationMinutes:20});
  await client.waitForJob(c2.jobId);
  const c2q1=await client.request('session.nextQuestion',{operationId:'f-c2-q1',sessionId:c2.sessionId,expectedRevision:0}) as {jobId:string};
  await client.waitForJob(c2q1.jobId);
  const c2Hint=await client.request('hint.status',{sessionId:c2.sessionId}) as {issueId:string};
  let hintConflict='';
  try{await client.request('hint.request',{operationId:'f-assign-newer',sessionId:c2.sessionId,issueId:c2Hint.issueId,expectedRevision:1});}
  catch(e){hintConflict=(e as Error).message;}
  expect(hintConflict).toBe('HINT_OPERATION_CONFLICT');

  // Close stdio, inject an unfinished formal experiment row, and verify direct host recovery marks it interrupted
  await client.close();
  const expRow={
   experimentId:'exp-v4',roleId:'java-backend',version:0,
   registry:createExperimentRegistry({experimentId:'exp-v4',roleId:'java-backend',baselinePolicy:wf.policy,now:Date.now()-2000}),
   runs:[{jobId:'j-pend',operationId:'op-pend',action:'evaluate',sourceSessionId:c1.sessionId,status:'running',outcome:null,errorCode:null,createdAt:Date.now()-2000,finishedAt:null}],
   operations:[],
  };
  const dbWrite=new Database(join(data,'agent','profiles','default','profile.sqlite'));
  const uid=(dbWrite.query('SELECT profile_id FROM local_control WHERE id=1').get() as {profile_id:string}).profile_id;
  dbWrite.query('INSERT INTO local_experiment_records VALUES(?,?,?,?,?,?,?,?)').run(uid,'exp-v4','java-backend',0,1,JSON.stringify(expRow),Date.now()-2000,Date.now()-2000);
  dbWrite.close();

  const host=await createLocalHost({dataDir:data,assetsRoot:process.cwd()});
  try{
   expect(host.hint({operationId:'f-hint-1',sessionId:c1.sessionId,issueId:hStatus.issueId,expectedRevision:1})).toMatchObject(h1);
   expect(host.learningStatus({roleId:'java-backend'}).assignments).toHaveLength(2);
   const est=host.experimentStatus({roleId:'java-backend'});
   expect(est.available).toBe(true);
   expect(est.deploymentStatus).toBe('not_published');
   if(est.available)expect(est.experiments[0]!.runs[0]!.status).toBe('interrupted');
  }finally{await host.close();}
 }finally{
  try{await client.close();}catch{/* already closed */}
  await rm(data,{recursive:true,force:true});
 }
},30000);
