import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createLocalHost} from '../apps/agent/src/local/host.ts';
import {createSqliteLearningFixture} from './fixtures/learning-repository.ts';
import {spawnLocalAgent} from '../packages/local-agent-client/src/index.ts';
import {LOCAL_LEARNING_CAPABILITY} from '../packages/contracts/src/local-learning.ts';
import {WorkflowSchema} from '../packages/contracts/src/session-workflow.ts';
import {Database} from 'bun:sqlite';

async function completeDualSkillSession(host:Awaited<ReturnType<typeof createLocalHost>>,prefix:string,roleId:'java-backend'|'web-frontend'){
 const run=async(m:Parameters<typeof host.command>[0],p:unknown)=>{const r=host.command(m,p);await host.wait(r.jobId);expect(host.job(r.jobId)).toMatchObject({status:'completed',errorCode:null});return r;};
 const c=await run('session.create',{operationId:`${prefix}-c`,roleId,goal:'learning flow',durationMinutes:20});
 await run('session.nextQuestion',{operationId:`${prefix}-q1`,sessionId:c.sessionId,expectedRevision:0});
 await run('session.answer',{operationId:`${prefix}-a1`,sessionId:c.sessionId,expectedRevision:1,text:'我会先说明前提边界与失败恢复机制，并通过重复测试验证结果。'});
 await run('session.nextQuestion',{operationId:`${prefix}-q2`,sessionId:c.sessionId,expectedRevision:2});
 await run('session.answer',{operationId:`${prefix}-a2`,sessionId:c.sessionId,expectedRevision:3,text:'我会继续补充并发可见性、原子更新与内存屏障边界，并在压测中对比验证。'});
 await run('session.complete',{operationId:`${prefix}-f`,sessionId:c.sessionId,expectedRevision:4});
 const view=host.answerPage({sessionId:c.sessionId});
 return{sessionId:c.sessionId,item:view.items[1]!};
}

test('default local host disables learning writes with LEARNING_STORAGE_UNAVAILABLE',async()=>{
 const data=await mkdtemp(join(tmpdir(),'learning-unavail-')),host=await createLocalHost({dataDir:data,assetsRoot:process.cwd()});
 try{
  expect(host.learningStatus({roleId:'java-backend'})).toEqual({available:false,reason:'LEARNING_STORAGE_UNAVAILABLE',assignments:[],xp:null});
  await expect(host.createLearningAssignment({operationId:'op1',roleId:'java-backend',sourceSessionId:'s',sourceAnswerId:'a',skillId:'java-jvm',resourceIds:[],requiredExerciseIds:['ex1'],predictedTargetScore:0.8})).rejects.toThrow('LEARNING_STORAGE_UNAVAILABLE');
 }finally{await host.close();await rm(data,{recursive:true,force:true});}
});

test('learning host enforces trust boundaries, retest exclusion, XP rules, CAS, rollback, and restart replay',async()=>{
 const data=await mkdtemp(join(tmpdir(),'learning-host-')),port=createSqliteLearningFixture();
 let at=Date.now();
 const options={dataDir:data,assetsRoot:process.cwd(),learning:port.repository};
 let host=await createLocalHost(options);
 try{
  const first=await completeDualSkillSession(host,'s1','java-backend');
  const db=new Database(join(data,'agent','profiles','default','profile.sqlite'),{readonly:true});
  const sourceWf=WorkflowSchema.parse(JSON.parse((db.query('SELECT workflow FROM local_sessions WHERE session_id=?').get(first.sessionId) as {workflow:string}).workflow));
  db.close();
  const turn=sourceWf.turns[1]!;
  const skillId=turn.input.question.skillId;

  // Create assignment & frozen prediction targeting an unseen question in the same skill
  const unseenTarget=sourceWf.catalogPin!.items.filter(i=>i.skillId===skillId&&i.id!==turn.input.question.id).sort((a,b)=>a.id.localeCompare(b.id))[0]!;
  const created=await host.createLearningAssignment({
   operationId:'assign-1',roleId:'java-backend',sourceSessionId:first.sessionId,sourceAnswerId:first.item.answerId,
   skillId,resourceIds:['spring-transaction-guide'],requiredExerciseIds:['ex-1'],dataMode:'synthetic',
   predictedTargetScore:0.8,targetDifficulty:unseenTarget.difficulty,targetRubricId:unseenTarget.id,
  });
  expect(created.summary.status).toBe('not_started');
  expect(created.version).toBe(0);

  // Idempotent replay
  expect(await host.createLearningAssignment({
   operationId:'assign-1',roleId:'java-backend',sourceSessionId:first.sessionId,sourceAnswerId:first.item.answerId,
   skillId,resourceIds:['spring-transaction-guide'],requiredExerciseIds:['ex-1'],dataMode:'synthetic',
   predictedTargetScore:0.8,targetDifficulty:unseenTarget.difficulty,targetRubricId:unseenTarget.id,
  })).toEqual(created);

  // Cross-module operationId collision
  expect(()=>host.command('session.create',{operationId:'assign-1',roleId:'web-frontend',goal:'collision',durationMinutes:20})).toThrow('VERSION_CONFLICT');

  // Public event allows self_reported_complete, rejects practice_verified
  const selfAt=Date.now();
  const selfRep=host.recordLearningEvent({operationId:'ev-self',assignmentId:created.assignmentId,expectedVersion:0,event:{id:'e1',occurredAt:selfAt,kind:'self_reported_complete'}});
  expect(selfRep.summary.status).toBe('self_reported');
  expect(()=>host.recordLearningEvent({operationId:'ev-forge',assignmentId:created.assignmentId,expectedVersion:1,event:{id:'e2',occurredAt:selfAt,kind:'practice_verified',exerciseId:'ex-1'} as never})).toThrow('VALIDATION_ERROR');

  // Recommendations now reflect self_reported status
  const rec=await host.practiceRecommendations({roleId:'java-backend',maxGoals:5});
  expect(rec.learningProgressAvailable).toBe(true);
  expect(rec.goals.find(g=>g.skillId===skillId)?.learningStatus).toBe('self_reported');

  // Atomic commit fault rolls back cleanly without changing version
  const verifyAt=Date.now();
  port.rejectCommits(true);
  expect(()=>host.verifyLearningPractice({operationId:'ver-fail',assignmentId:created.assignmentId,expectedVersion:1,exerciseId:'ex-1',artifactId:'art-1',verifierId:'v1',verifiedAt:verifyAt,occurredAt:verifyAt})).toThrow('synthetic commit fault');
  port.rejectCommits(false);
  expect(host.learningStatus({roleId:'java-backend'}).assignments[0]!.version).toBe(1);

  // Host-trusted verification succeeds
  const verified=host.verifyLearningPractice({operationId:'ver-1',assignmentId:created.assignmentId,expectedVersion:1,exerciseId:'ex-1',artifactId:'art-1',verifierId:'v1',verifiedAt:verifyAt,occurredAt:verifyAt});
  expect(verified.summary.status).toBe('verified_complete');

  // CAS conflict on stale expectedVersion
  expect(()=>host.recordLearningEvent({operationId:'ev-stale',assignmentId:created.assignmentId,expectedVersion:0,event:{id:'e3',occurredAt:verifyAt,kind:'self_reported_complete'}})).toThrow('VERSION_CONFLICT');

  // Start second session & verify retest plan excludes seen questions without leaking text/rubric
  const run=async(m:Parameters<typeof host.command>[0],p:unknown)=>{const r=host.command(m,p);await host.wait(r.jobId);return r;};
  const s2=await run('session.create',{operationId:'s2-c',roleId:'java-backend',goal:'retest',durationMinutes:20});
  const planView=host.planLearningRetest({assignmentId:created.assignmentId,sessionId:s2.sessionId});
  expect(planView.status).toBe('ready');
  expect(planView.candidateAvailable).toBe(true);
  expect(JSON.stringify(planView)).not.toContain('anchors');

  // Complete a second session answer & pair retest -> check non-stacking XP (100 interview? No, 1 normal + 1 verified learning + 1 retest = 230, or if different answer)
  await run('session.nextQuestion',{operationId:'s2-q1',sessionId:s2.sessionId,expectedRevision:0});
  await run('session.answer',{operationId:'s2-a1',sessionId:s2.sessionId,expectedRevision:1,text:'我会先检查Spring代理入口、传播边界以及回滚条件。'});
  await run('session.complete',{operationId:'s2-f',sessionId:s2.sessionId,expectedRevision:2});
  const s2Answer=host.answerPage({sessionId:s2.sessionId}).items[0]!;
  const pairAt=Math.max(at+2000,Date.now());
  const paired=await host.pairLearningRetest({
   operationId:'pair-1',assignmentId:created.assignmentId,expectedVersion:verified.version,
   retestSessionId:s2.sessionId,retestAnswerId:s2Answer.answerId,dataMode:'synthetic',
   reference:{basis:'synthetic-fixture',reviewId:'rev-1',reviewerId:'r-1',answerId:s2Answer.answerId,rubricId:s2Answer.questionId,rubricVersion:'bank-0.1',score:0.85,reviewedAt:pairAt},
  });
  expect(paired.retestPair).not.toBeNull();
  const status=host.learningStatus({roleId:'java-backend'});
  expect(status.available).toBe(true);
  if(status.available){
   // s1 = normal interview (100), learning verified (30), s2 = retest (100, does NOT stack with interview!) => 230 XP
   expect(status.xp).toEqual({totalXp:230,level:1,completedInterviews:1,verifiedLearnings:1,completedRetests:1});
  }

  // Restart preserves records & idempotent replay
  await host.close();
  host=await createLocalHost(options);
  expect(host.learningStatus({roleId:'java-backend'}).assignments[0]!.version).toBe(3);
  expect(await host.createLearningAssignment({
   operationId:'assign-1',roleId:'java-backend',sourceSessionId:first.sessionId,sourceAnswerId:first.item.answerId,
   skillId,resourceIds:['spring-transaction-guide'],requiredExerciseIds:['ex-1'],dataMode:'synthetic',
   predictedTargetScore:0.8,targetDifficulty:unseenTarget.difficulty,targetRubricId:unseenTarget.id,
  })).toEqual(created);
 }finally{await host.close();await rm(data,{recursive:true,force:true});}
});

test('stdio runtime without injected learning repo reports unavailable and does not advertise local-learning-v1',async()=>{
 const data=await mkdtemp(join(tmpdir(),'learning-stdio-'));
 const client=await spawnLocalAgent({executable:process.execPath,entry:resolve('apps/agent/src/local/index.ts'),dataDir:data,assetsRoot:process.cwd(),cwd:tmpdir()});
 try{
  const init=await client.request('runtime.initialize',{}) as {capabilities:string[]};
  expect(init.capabilities).not.toContain(LOCAL_LEARNING_CAPABILITY);
  const st=await client.getLearningStatus('java-backend');
  expect(st).toEqual({available:false,reason:'LEARNING_STORAGE_UNAVAILABLE',assignments:[],xp:null});
 }finally{await client.close();await rm(data,{recursive:true,force:true});}
});
