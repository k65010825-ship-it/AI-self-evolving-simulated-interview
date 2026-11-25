import {test,expect} from 'bun:test';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createLocalHost} from '../apps/agent/src/local/host.ts';
import type {HintRepository} from '../apps/agent/src/hints/repository-port.ts';
import {createSqliteHintFixture as fixture} from './fixtures/hint-repository.ts';
import {Database} from 'bun:sqlite';import {reserveHint} from '../apps/agent/src/hints/limited-hints.ts';import type {HintJournal} from '../packages/contracts/src/hints.ts';
async function setup(roleId:'java-backend'|'web-frontend',hints?:HintRepository|null){const dataDir=await mkdtemp(join(tmpdir(),'hint-host-'));const options={dataDir,assetsRoot:process.cwd(),...(hints!==undefined?{hints}:{})};
 let host=await createLocalHost(options);const created=host.command('session.create',{operationId:'create',roleId,goal:'hint tests',durationMinutes:20});await host.wait(created.jobId);
 const q=host.command('session.nextQuestion',{operationId:'plan',sessionId:created.sessionId,expectedRevision:0});await host.wait(q.jobId);
 return{host,options,sessionId:created.sessionId,cleanup:()=>rm(dataDir,{recursive:true,force:true})};}
test('explicit null hint repository exposes unavailable status and cannot silently use volatile hint counters',async()=>{
 const f=await setup('java-backend',null);try{expect(f.host.hintStatus({sessionId:f.sessionId})).toMatchObject({available:false,reason:'HINT_STORAGE_UNAVAILABLE'});
  expect(()=>f.host.hint({operationId:'h',sessionId:f.sessionId,issueId:'a'.repeat(64),expectedRevision:1})).toThrow('HINT_STORAGE_UNAVAILABLE');
 }finally{await f.host.close();await f.cleanup();}
});
test('repository commit fault rolls back successful count, leaves no delivered assistance and releases reservation',async()=>{
 const port=fixture(),f=await setup('java-backend',port.repository);
 try{const status=f.host.hintStatus({sessionId:f.sessionId});const cmd={operationId:'failed',sessionId:f.sessionId,issueId:status.issueId,expectedRevision:1};
  port.rejectCommits(true);expect(()=>f.host.hint(cmd)).toThrow('synthetic commit fault');
  expect(f.host.hintStatus({sessionId:f.sessionId})).toMatchObject({used:0,remaining:2,reserved:false});
  port.rejectCommits(false);expect(()=>f.host.hint(cmd)).toThrow('HINT_OPERATION_RELEASED');
  expect(f.host.hint({...cmd,operationId:'new-attempt'})).toMatchObject({level:1,remaining:1});
  expect(()=>f.host.command('session.answer',{operationId:'new-attempt',sessionId:f.sessionId,expectedRevision:1,text:'x'})).toThrow('VERSION_CONFLICT');
 }finally{await f.host.close();await f.cleanup();}
});
for(const roleId of ['java-backend','web-frontend'] as const)test(`${roleId}: injected host limits/replays across restart and attaches receipts to clarified answers`,async()=>{
 const port=fixture(),f=await setup(roleId,port.repository);let host=f.host;
 try{
  const status=host.hintStatus({sessionId:f.sessionId});if(!status.issueId)throw Error('issue');
  const cmd={operationId:'hint-1',sessionId:f.sessionId,issueId:status.issueId,expectedRevision:1};
  expect(()=>host.hint({...cmd,issueId:'b'.repeat(64)})).toThrow('HINT_ISSUE_MISMATCH');
  const one=host.hint(cmd);expect(one).toMatchObject({level:1,remaining:1});
  expect(()=>host.speech('speech.tts.start',{operationId:'hint-1',sessionId:f.sessionId,expectedRevision:host.session(f.sessionId).revision})).toThrow('VERSION_CONFLICT');
  const answer=host.command('session.answer',{operationId:'answer-gap',sessionId:f.sessionId,expectedRevision:host.session(f.sessionId).revision,text:'不知道'});await host.wait(answer.jobId);
  expect(host.job(answer.jobId)).toMatchObject({status:'completed',errorCode:null});
  expect(host.session(f.sessionId).phase).toBe('awaiting_answer');expect(host.hintStatus({sessionId:f.sessionId}).issueId).toBe(status.issueId);
  expect(()=>host.hint({...cmd,operationId:'stale'})).toThrow('VERSION_CONFLICT');
  const two=host.hint({...cmd,operationId:'hint-2',expectedRevision:host.session(f.sessionId).revision});expect(two).toMatchObject({level:2,remaining:0});
  expect(()=>host.hint({...cmd,operationId:'third',expectedRevision:host.session(f.sessionId).revision})).toThrow('HINT_LIMIT_REACHED');
  await host.close();host=await createLocalHost(f.options);
  expect(host.hint(cmd)).toEqual(one);expect(host.hintStatus({sessionId:f.sessionId})).toMatchObject({used:2,remaining:0});
  const task=host.command('session.answer',{operationId:'answer-after-hint',sessionId:f.sessionId,expectedRevision:host.session(f.sessionId).revision,text:'不知道\n我需要先明确前提和边界。'});
  expect(()=>host.hint({...cmd,operationId:'while-answer',expectedRevision:2})).toThrow('SESSION_BUSY');
  await host.wait(task.jobId);const views=host.answerPage({sessionId:f.sessionId});
  expect(views.items[0]?.assistance).toMatchObject({kind:'hint-assisted',receiptIds:['hint-1','hint-2']});
  const finish=host.command('session.complete',{operationId:'finish',sessionId:f.sessionId,expectedRevision:host.session(f.sessionId).revision});await host.wait(finish.jobId);
  expect(host.hint(cmd)).toEqual(one);expect(host.status().modelHttpAttempts).toBe(0);
 }finally{await host.close();await f.cleanup();}
});
test('removing the optional repository after a committed hint cannot erase assistance on restart',async()=>{
 const port=fixture(),f=await setup('java-backend',port.repository);let host=f.host;
 try{const s=host.hintStatus({sessionId:f.sessionId});host.hint({operationId:'hint',sessionId:f.sessionId,issueId:s.issueId,expectedRevision:1});
  await host.close();host=await createLocalHost({dataDir:f.options.dataDir,assetsRoot:f.options.assetsRoot,hints:null});
  expect(()=>host.speech('speech.tts.start',{operationId:'hint',sessionId:f.sessionId,expectedRevision:host.session(f.sessionId).revision})).toThrow('VERSION_CONFLICT');
  const task=host.command('session.answer',{operationId:'answer',sessionId:f.sessionId,expectedRevision:host.session(f.sessionId).revision,text:'我先明确前提与边界。'});await host.wait(task.jobId);
  expect(host.job(task.jobId).status).toBe('completed');expect(host.answerPage({sessionId:f.sessionId}).items[0]?.assistance).toMatchObject({kind:'hint-assisted',receiptIds:['hint']});
 }finally{await host.close();await f.cleanup();}
});
test('a repository that loses committed history cannot reset an existing workflow hint marker',async()=>{
 const port=fixture(),f=await setup('java-backend',port.repository);let host=f.host;
 try{const s=host.hintStatus({sessionId:f.sessionId});host.hint({operationId:'one',sessionId:f.sessionId,issueId:s.issueId,expectedRevision:1});await host.close();
  host=await createLocalHost({...f.options,hints:{...port.repository,load:()=>null,pending:()=>[],findOperation:()=>null}});
  expect(()=>host.hint({operationId:'two',sessionId:f.sessionId,issueId:s.issueId,expectedRevision:host.session(f.sessionId).revision})).toThrow('HINT_BINDING_MISMATCH');
 }finally{await host.close();await f.cleanup();}
});
test('startup releases staged template reservation without changing committed hints or unknown model budget',async()=>{
 const port=fixture(),f=await setup('java-backend',port.repository);let host=f.host;
 try{const status=host.hintStatus({sessionId:f.sessionId}),cmd={operationId:'one',sessionId:f.sessionId,issueId:status.issueId,expectedRevision:1},receipt=host.hint(cmd);await host.close();
  const db=new Database(join(f.options.dataDir,'agent','profiles','default','profile.sqlite'));
  try{const row=db.query('SELECT body FROM test_hint_fixture').get() as {body:string};
   const staged=reserveHint(JSON.parse(row.body) as HintJournal,'interrupted-template',Date.now());
   db.query('UPDATE test_hint_fixture SET body=?,version=?').run(JSON.stringify(staged),staged.version);
   db.query('INSERT INTO local_budget VALUES(?,?,?,?,?,?,?)').run('legacy-unknown','synthetic-job','unknown','llm',100,null,null);
  }finally{db.close();}
  host=await createLocalHost(f.options);expect(host.hintStatus({sessionId:f.sessionId})).toMatchObject({used:1,remaining:1,reserved:false});
  expect(host.hint(cmd)).toEqual(receipt);expect(()=>host.hint({...cmd,operationId:'two',expectedRevision:host.session(f.sessionId).revision})).toThrow('BUDGET_RECONCILIATION_REQUIRED');
  expect(host.status()).toMatchObject({unknownAttempts:1,executionStarts:0,modelHttpAttempts:0});
 }finally{await host.close();await f.cleanup();}
});
