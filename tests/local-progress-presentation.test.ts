import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalHost} from '../apps/agent/src/local/host.ts';
import {createSqliteHintFixture} from './fixtures/hint-repository.ts';
import {buildProfileView,buildPracticeRecommendationsView,buildReflectionListView} from '../apps/agent/src/local/progress-presentation.ts';
import {createMemory} from '../apps/agent/src/memory/session-memory.ts';
import {WorkflowSchema} from '../packages/contracts/src/session-workflow.ts';
import {Database} from 'bun:sqlite';

test('empty profile views stay honest with 6 main skills, unavailable learning status, draft warnings, and not_published calibration',async()=>{
 const now=Date.now(),memory=createMemory({userId:'u1',roleId:'java-backend'},now);
 const profile=buildProfileView({memory,workflows:[],assetsRoot:process.cwd(),now,rawQuery:{roleId:'java-backend'}});
 expect(profile.mainSkills).toHaveLength(6);
 expect(profile.behavioralSkills).toHaveLength(1);
 expect(profile.mainSkills.every(s=>s.mastery===null&&s.confidence===0&&s.independentQuestions===0)).toBe(true);
 expect(profile.growthPoints).toEqual([]);

 const rec=await buildPracticeRecommendationsView({memory:createMemory({userId:'u1',roleId:'web-frontend'},now),workflows:[],assetsRoot:process.cwd(),now,rawQuery:{roleId:'web-frontend',maxGoals:3},learningAvailable:false});
 expect(rec.learningProgressAvailable).toBe(false);
 expect(rec.goals.length).toBe(3);
 expect(rec.goals.every(g=>g.learningStatus==='unavailable')).toBe(true);
 expect(rec.resources.some(r=>r.resource.reviewStatus==='draft')).toBe(true);
 expect(rec.warnings.some(w=>w.includes('unavailable'))).toBe(true);

 const refl=buildReflectionListView({workflows:[],now,rawQuery:{roleId:'java-backend'}});
 expect(refl.deploymentStatus).toBe('not_published');
 expect(refl.calibration).toMatchObject({status:'unavailable',mae:null,minimumPairs:8,minimumStudents:2});
 expect(refl.items).toEqual([]);
});

test('profile, recommendations, and reflections isolate assisted answers, enforce version conflicts, and never trigger writes or model calls',async()=>{
 const data=await mkdtemp(join(tmpdir(),'progress-views-')),hints=createSqliteHintFixture();
 const host=await createLocalHost({dataDir:data,assetsRoot:process.cwd(),hints:hints.repository});
 const run=async(m:Parameters<typeof host.command>[0],p:unknown)=>{const r=host.command(m,p);await host.wait(r.jobId);expect(host.job(r.jobId).status).toBe('completed');return r;};
 try{
  const s1=await run('session.create',{operationId:'c1',roleId:'java-backend',goal:'g1',durationMinutes:20});
  await run('session.nextQuestion',{operationId:'q1',sessionId:s1.sessionId,expectedRevision:0});
  await run('session.answer',{operationId:'a1',sessionId:s1.sessionId,expectedRevision:1,text:'我会先定义事务边界与并发控制条件，再说明失败恢复与测试验证。'});
  await run('session.nextQuestion',{operationId:'q2',sessionId:s1.sessionId,expectedRevision:2});
  const issueId=host.hintStatus({sessionId:s1.sessionId}).issueId!;
  host.hint({operationId:'h1',sessionId:s1.sessionId,issueId,expectedRevision:3});
  await run('session.answer',{operationId:'a2',sessionId:s1.sessionId,expectedRevision:4,text:'我会使用乐观锁或原子操作避免并发竞态，并通过并发测试验证。'});
  await run('session.complete',{operationId:'f1',sessionId:s1.sessionId,expectedRevision:5});

  const beforeStatus=host.status();
  const profile=host.profileView({roleId:'java-backend'});
  expect(profile.memoryVersion).toBe(1);
  expect(profile.growthPoints).toHaveLength(1);
  expect(profile.growthPoints[0]!.scoredAnswers).toBe(2);
  expect(profile.growthPoints[0]!.independentQuestions).toBe(1);
  expect(profile.mainSkills.reduce((n,s)=>n+s.assistedExcludedCount,0)).toBe(1);
  expect(()=>host.profileView({roleId:'java-backend',expectedMemoryVersion:99})).toThrow('VERSION_CONFLICT');

  const rec=await host.practiceRecommendations({roleId:'java-backend',maxGoals:4});
  expect(rec.learningProgressAvailable).toBe(false);
  expect(rec.goals).toHaveLength(4);
  expect(JSON.stringify(rec)).not.toContain('anchors');
  expect(()=>WorkflowSchema.parse(rec)).toThrow();

  const refl=host.reflections({roleId:'java-backend'});
  expect(refl.deploymentStatus).toBe('not_published');
  expect(refl.items).toHaveLength(1);
  expect(refl.items[0]!.metrics.skillCoverage.denominator).toBe(7);
  expect(refl.items[0]!.findings.some(f=>f.code==='assisted_evidence')).toBe(true);
  expect(()=>host.reflections({roleId:'java-backend',expectedSourceDigest:'0'.repeat(64)})).toThrow('VERSION_CONFLICT');
  expect(host.status()).toEqual(beforeStatus);

  // Verify pagination and incompatible exclusion check with a second direct read
  const db=new Database(join(data,'agent','profiles','default','profile.sqlite'),{readonly:true});
  try{
   const w=WorkflowSchema.parse(JSON.parse((db.query('SELECT workflow FROM local_sessions WHERE session_id=?').get(s1.sessionId) as {workflow:string}).workflow));
   const p0=buildReflectionListView({workflows:[w,w],now:Date.now(),rawQuery:{roleId:'java-backend',limit:1,offset:0}});
   expect(p0.page).toEqual({offset:0,limit:1,total:2,nextOffset:1});
   expect(p0.items).toHaveLength(1);
  }finally{db.close();}
 }finally{await host.close();await rm(data,{recursive:true,force:true});}
});
