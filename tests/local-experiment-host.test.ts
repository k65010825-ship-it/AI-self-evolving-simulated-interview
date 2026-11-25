import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createLocalHost} from '../apps/agent/src/local/host.ts';
import {createSqliteExperimentFixture} from './fixtures/experiment-repository.ts';
import {createPolicyValidationSuite} from '../evals/policy/validation-scenarios.ts';
import {createReflectionFixture} from '../experiments/reflection/session-fixture.ts';
import {spawnLocalAgent} from '../packages/local-agent-client/src/index.ts';
import {LOCAL_EXPERIMENTS_CAPABILITY} from '../packages/contracts/src/local-experiment.ts';
import {Database} from 'bun:sqlite';

test('explicit null experiments repo disables experiments with EXPERIMENT_STORAGE_UNAVAILABLE and not_published',async()=>{
 const data=await mkdtemp(join(tmpdir(),'exp-unavail-')),host=await createLocalHost({dataDir:data,assetsRoot:process.cwd(),experiments:null});
 try{
  expect(host.experimentStatus({roleId:'java-backend'})).toEqual({available:false,reason:'EXPERIMENT_STORAGE_UNAVAILABLE',deploymentStatus:'not_published',experiments:[]});
  await expect(host.evaluateExperiment({operationId:'e1',experimentId:'exp1',roleId:'java-backend',sourceSessionId:'s1',nextSessionId:'next1'})).rejects.toThrow('EXPERIMENT_STORAGE_UNAVAILABLE');
 }finally{await host.close();await rm(data,{recursive:true,force:true});}
});

test('experiment host evaluates offline candidate, supports rollback, atomic fault rollback, restart replay, and pending recovery',async()=>{
 const data=await mkdtemp(join(tmpdir(),'exp-host-')),port=createSqliteExperimentFixture();
 const fixture=await createReflectionFixture('java-backend');
 let at=Math.max(Date.now(),fixture.generatedAt+5000);
 const options={dataDir:data,assetsRoot:process.cwd(),experiments:port.repository,now:()=>++at};
 let host=await createLocalHost(options);
 try{
  // Seed a completed session matching the reflection fixture's workflow inside local_sessions
  // Build a real completed workflow from the fixture's reportInput by closing via local_sessions directly?
  // Better: run a quick real 3-turn single-skill session or reuse fixture workflow via finishInterviewWorkflow!
  // Let's create a real 3-turn session with pressure=true (maxFollowupDepth=2) on a single skill?
  // Or insert a valid completed workflow from finishInterviewWorkflow into local_sessions!
  const {createInterviewWorkflow,finishInterviewWorkflow}=await import('../apps/agent/src/orchestration/session-workflow.ts');
  const {evaluateTurn}=await import('../apps/agent/src/orchestration/evaluate-turn.ts');
  const {resolvePinnedCatalog,catalogHistoryCompatibility}=await import('../apps/agent/src/knowledge/catalog.ts');
  const {WorkflowSchema}=await import('../packages/contracts/src/session-workflow.ts');
  const pin=resolvePinnedCatalog('java-backend','draft-preview',['spring-transactions','java-concurrency','project-design']);
  const ctlDb=new Database(join(data,'agent','profiles','default','profile.sqlite'),{readonly:true});
  const profileId=(ctlDb.query('SELECT profile_id FROM local_control WHERE id=1').get() as {profile_id:string}).profile_id;
  ctlDb.close();
  let wf=createInterviewWorkflow({
   identity:{userId:profileId,roleId:'java-backend'},
   catalogPin:pin,
   session:{sessionId:'exp-src-1',roleId:'java-backend',durationMinutes:20,historyCompatibility:catalogHistoryCompatibility(pin),
    skills:[{skillId:'spring-transactions',relevance:1},{skillId:'java-concurrency',relevance:0.1},{skillId:'project-design',relevance:0.1}]},
   policy:{id:'local-exp-v1',roleId:'java-backend',parameters:{maxFollowupDepth:2,maxTurns:6,wrapUpSeconds:45}},
   goal:'single skill deep',skillLabels:{'spring-transactions':'Spring','java-concurrency':'Java','project-design':'Design'},
   allowDraftKnowledge:true,now:at-60000,
  });
  const turns=[],askedQuestionIds:string[]=[],issuedQuestions:{questionId:string;issuedAt:number}[]=[];
  let state=wf.state;
  const rubric={id:'exp-rubric',version:'1',roleId:'java-backend' as const,scope:'technical-content' as const,criteria:[{id:'correctness',maxScore:4,weight:1,required:true as const}]};
  for(let i=0;i<3;i++){
   const qId='exp-q-'+i,issuedAt=at-55000+i*1000;
   askedQuestionIds.push(qId);issuedQuestions.push({questionId:qId,issuedAt});
   const input={state,expectedVersion:state.version,observationId:'o'+i,goal:wf.goal,
    context:{userId:wf.identity.userId,roleId:'java-backend' as const,runId:'r'+i,attemptId:'a1',deadlineAt:at+120000},
    question:{id:qId,roleId:'java-backend' as const,skillId:'spring-transactions',text:'说明Spring事务边界',questionType:'technical' as const,difficulty:1},
    answer:{id:'ans-'+i,text:'事务边界'},quality:1,knowledge:[],planningPolicy:wf.policy,rubric};
   const proposal=await evaluateTurn(input,{now:()=>at-50000+i*1000,evaluate:async()=>({
    evidence:[{id:'e',start:0,end:4,excerpt:'事务边界'}],criterionScores:[{criterionId:'correctness',score:1,evidenceIds:['e']}],
    feedback:{strengths:['离线固定'],improvements:['补充覆盖']}})});
   turns.push({input,proposal,evidenceMode:'offline-fixture' as const});
   state=proposal.nextState;
  }
  wf=WorkflowSchema.parse({...wf,revision:turns.length,state,turns,askedQuestionIds,issuedQuestions});
  wf=await finishInterviewWorkflow(wf,{identity:wf.identity,expectedRevision:wf.revision,mode:'user_stop',sourceGroupId:'grp-src'});
  expect(wf.closeout!.reflection.candidate).not.toBeNull();
  at=Math.max(at,Date.now(),wf.closeout!.generatedAt)+2000;

  const db=new Database(join(data,'agent','profiles','default','profile.sqlite'));
  db.query('INSERT INTO local_sessions VALUES(?,?,?,?,?,?)').run(wf.state.sessionId,'java-backend',1,JSON.stringify(wf),wf.state.startedAt,wf.state.deadlineAt);
  db.close();

  const suite=createPolicyValidationSuite('java-backend');
  // Commit fault rolls back cleanly
  port.rejectCommits(true);
  await expect(host.evaluateExperiment({operationId:'exp-fail',experimentId:'exp-1',roleId:'java-backend',sourceSessionId:wf.state.sessionId,suite,nextSessionId:'next-1'})).rejects.toThrow('synthetic commit fault');
  port.rejectCommits(false);
  expect(host.experimentStatus({roleId:'java-backend'}).experiments).toEqual([]);

  // Evaluate activates offline without publishing
  const evalRes=await host.evaluateExperiment({operationId:'exp-eval-1',experimentId:'exp-1',roleId:'java-backend',sourceSessionId:wf.state.sessionId,suite,nextSessionId:'next-2'});
  expect(evalRes).toMatchObject({experimentId:'exp-1',scope:'offline-experiment',productionPublished:false,deploymentStatus:'not_published',status:'evaluated_activated_offline',outcome:'activated',registryVersion:1});
  expect(evalRes.activePolicyId).toContain('depth-1-');

  // Replay returns replayed result cleanly
  expect(await host.evaluateExperiment({operationId:'exp-eval-1',experimentId:'exp-1',roleId:'java-backend',sourceSessionId:wf.state.sessionId,suite,nextSessionId:'next-2'})).toEqual(evalRes);

  // Cross-module operationId collision
  expect(()=>host.command('session.create',{operationId:'exp-eval-1',roleId:'web-frontend',goal:'collision',durationMinutes:20})).toThrow('VERSION_CONFLICT');

  // Rollback reverts activePolicyId within offline experiment scope
  const rb=host.rollbackExperiment({operationId:'exp-rb-1',experimentId:'exp-1',roleId:'java-backend',expectedRegistryVersion:1,targetPolicyId:'local-exp-v1',reason:'回归测试人工回退'});
  expect(rb).toMatchObject({status:'rolled_back',activePolicyId:'local-exp-v1',registryVersion:2,productionPublished:false,deploymentStatus:'not_published'});

  // Inject an unfinished run and verify startup recovers it to interrupted without re-execution
  await host.close();
  const db2=new Database(join(data,'agent','profiles','default','profile.sqlite'));
  const row=db2.query('SELECT body FROM test_experiment_fixture').get() as {body:string};
  const rec=JSON.parse(row.body);
  rec.runs.push({jobId:'pending-job',operationId:'pending-op',action:'evaluate',sourceSessionId:wf.state.sessionId,status:'running',outcome:null,errorCode:null,createdAt:at,finishedAt:null});
  db2.query('UPDATE test_experiment_fixture SET body=?').run(JSON.stringify(rec));
  db2.close();

  host=await createLocalHost(options);
  const st=host.experimentStatus({roleId:'java-backend'});
  expect(st.available).toBe(true);
  if(st.available){
   expect(st.experiments[0]!.runs.find(r=>r.jobId==='pending-job')?.status).toBe('interrupted');
   expect(st.experiments[0]!.activePolicyId).toBe('local-exp-v1');
  }
 }finally{await host.close();await rm(data,{recursive:true,force:true});}
});

test('stdio runtime enables default formal experiments repo and advertises local-experiments-v1',async()=>{
 const data=await mkdtemp(join(tmpdir(),'exp-stdio-'));
 const client=await spawnLocalAgent({executable:process.execPath,entry:resolve('apps/agent/src/local/index.ts'),dataDir:data,assetsRoot:process.cwd(),cwd:tmpdir()});
 try{
  const init=await client.request('runtime.initialize',{}) as {capabilities:string[]};
  expect(init.capabilities).toContain(LOCAL_EXPERIMENTS_CAPABILITY);
  const st=await client.getExperimentStatus('java-backend');
  expect(st).toEqual({available:true,reason:null,deploymentStatus:'not_published',experiments:[]});
 }finally{await client.close();await rm(data,{recursive:true,force:true});}
});
