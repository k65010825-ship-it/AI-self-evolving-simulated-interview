import {test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Database} from 'bun:sqlite';
import {createSpeechTaskManager} from '../apps/agent/src/speech/task-manager.ts';
import {makeSpeechFixture} from '../experiments/speech/fixture.ts';
import {createAsrProvider} from '../apps/agent/src/speech/bailian-asr.ts';
import config from '../apps/agent/src/speech/qianwen-omni.example.json' with {type:'json'};
export function speechTaskFixture(role:'java-backend'|'web-frontend'='java-backend'){
 const f=makeSpeechFixture(role),speechId=`speech-task-${role}`;
 const request={speechId,context:{...f.input.context,runId:speechId},binding:{sessionId:'session-1',questionId:'question-1',answerId:'answer-1',sessionVersion:1},
  audio:{sha256:createHash('sha256').update(f.wavBytes).digest('hex'),byteLength:f.wavBytes.length}};
 return{...f,request,owner:{userId:request.context.userId,roleId:role}};
}
function temporary(){const dir=mkdtempSync(join(tmpdir(),'speech-task-'));return {path:join(dir,'tasks.sqlite'),clean(){for(const f of readdirSync(dir))unlinkSync(join(dir,f));rmdirSync(dir);}};}
test('speech tasks persist exact idempotency/source and server-generated confirmation for both roles',async()=>{
 for(const role of ['java-backend','web-frontend'] as const){const t=temporary(),f=speechTaskFixture(role);let calls=0;
  const deps={path:t.path,authorize:async()=>true,providerFor:()=>({...f.provider,transcribe:async()=>{calls++;return f.provider.transcribe({wavBytes:f.wavBytes,durationMs:6000,sampleRate:16000},new AbortController().signal);}})};
  let m=createSpeechTaskManager(deps);
  try{expect((await m.create(f.request)).status).toBe('awaiting_audio');await m.create(f.request);
   await expect(m.create({...f.request,binding:{...f.request.binding,questionId:'changed'}})).rejects.toThrow('VERSION_CONFLICT');
   expect((await m.upload(f.request.speechId,f.owner,f.wavBytes)).status).toBe('running');await m.wait(f.request.speechId);
   const ready=await m.snapshot(f.request.speechId,f.owner);expect(ready.status).toBe('transcribed');
   const command={expectedVersion:ready.version,text:f.text+'。'},confirmed=await m.confirm(f.request.speechId,f.owner,command);
   expect(confirmed.answer?.answer.id).toBe(f.request.binding.answerId);expect(confirmed.answer?.transcription.originalText).toBe(f.text);
   expect(confirmed.answer?.warnings).toEqual(['confirmed_text_differs_from_asr']);
   expect(await m.confirm(f.request.speechId,f.owner,command)).toEqual(confirmed);
   await expect(m.confirm(f.request.speechId,f.owner,{...command,text:'different'})).rejects.toThrow('VERSION_CONFLICT');
   m.close();m=createSpeechTaskManager(deps);
   expect(await m.upload(f.request.speechId,f.owner,f.wavBytes)).toEqual(confirmed);expect(calls).toBe(1);
   expect(await m.snapshot(f.request.speechId,f.owner)).toEqual(confirmed);
  }finally{m.close();t.clean();}
 }
});
test('owner, stale question authorization, hash and confirmation schema reject before provider dispatch',async()=>{
 const t=temporary(),f=speechTaskFixture();let allowed=true,calls=0;
 const m=createSpeechTaskManager({path:t.path,authorize:async()=>allowed,providerFor:()=>{calls++;return f.provider;}});
 try{await m.create(f.request);
  for(const owner of [{...f.owner,userId:'another-student'},{...f.owner,roleId:'web-frontend' as const}])
   await expect(m.snapshot(f.request.speechId,owner)).rejects.toThrow();
  const bytes=new Uint8Array(f.wavBytes);bytes[100]=bytes[100]!^1;await expect(m.upload(f.request.speechId,f.owner,bytes)).rejects.toThrow('VERSION_CONFLICT');
  allowed=false;await expect(m.upload(f.request.speechId,f.owner,f.wavBytes)).rejects.toThrow('FORBIDDEN');expect(calls).toBe(0);
  allowed=true;await m.upload(f.request.speechId,f.owner,f.wavBytes);await m.wait(f.request.speechId);
  const s=await m.snapshot(f.request.speechId,f.owner);allowed=false;
  await expect(m.confirm(f.request.speechId,f.owner,{expectedVersion:s.version,text:f.text})).rejects.toThrow('FORBIDDEN');
  allowed=true;await expect(m.confirm(f.request.speechId,f.owner,{expectedVersion:s.version,text:f.text,transcription:{}})).rejects.toThrow('VALIDATION_ERROR');
 }finally{m.close();t.clean();}
});
test('two managers and concurrent uploads claim only once; cancellation fences late result',async()=>{
 const t=temporary(),f=speechTaskFixture();let release!:(value:unknown)=>void,calls=0;
 const provider={...f.provider,transcribe:async()=>{calls++;return new Promise<unknown>(r=>{release=r;});}};
 const deps={path:t.path,authorize:async()=>true,providerFor:()=>provider};
 const a=createSpeechTaskManager(deps),b=createSpeechTaskManager(deps);
 try{await a.create(f.request);await Promise.all([a.upload(f.request.speechId,f.owner,f.wavBytes),b.upload(f.request.speechId,f.owner,f.wavBytes)]);
  await new Promise(r=>setTimeout(r,0));expect(calls).toBe(1);
  await b.cancel(f.request.speechId,f.owner);release({text:f.text,language:'zh-CN',segments:[]});await a.wait(f.request.speechId);
  const s=await a.snapshot(f.request.speechId,f.owner);expect(s.status).toBe('cancelled');expect(s.transcript).toBeUndefined();
  await b.upload(f.request.speechId,f.owner,f.wavBytes);expect(calls).toBe(1);
 }finally{a.close();b.close();t.clean();}
});
test('ASR checkpoint is persisted before HTTP and preserved after cancellation/reopen',async()=>{
 const t=temporary(),f=speechTaskFixture();let started!:()=>void;const entered=new Promise<void>(r=>{started=r;});
 const deps={path:t.path,authorize:async()=>true,providerFor:({context,onCheckpoint}:any)=>createAsrProvider({...config,enabled:true,authorization:{allowLive:true,expiresAt:Date.now()+60000}},
  {context,onCheckpoint,readCredential:()=> 'synthetic',fetch:async()=>{started();return new Promise<Response>(()=>{});}})};
 let m=createSpeechTaskManager(deps);
 try{await m.create(f.request);await m.upload(f.request.speechId,f.owner,f.wavBytes);await entered;
  expect((await m.snapshot(f.request.speechId,f.owner)).accounting?.entries[0]?.status).toBe('dispatched');
  await m.cancel(f.request.speechId,f.owner);await m.wait(f.request.speechId);m.close();m=createSpeechTaskManager(deps);
  const s=await m.snapshot(f.request.speechId,f.owner);expect(s.status).toBe('cancelled');expect(s.accounting?.blocked).toBe(true);
  expect(s.accounting?.entries[0]?.status).toBe('unknown');expect(s.accounting?.heldCostMicros).toBe(100000);
 }finally{m.close();t.clean();}
});
test('expired crashed claim becomes interrupted/unknown and duplicate never dispatches',async()=>{
 const t=temporary(),f=speechTaskFixture();let at=Date.now(),calls=0;
 const deps={path:t.path,now:()=>at,authorize:async()=>true,providerFor:()=>{calls++;return f.provider;}};
 let m=createSpeechTaskManager(deps);
 try{await m.create(f.request);m.close();
  const db=new Database(t.path);const r=db.query('SELECT snapshot FROM speech_tasks').get() as {snapshot:string};const s=JSON.parse(r.snapshot);
  s.status='running';s.executionDeadlineAt=at+1000;s.version++;
  s.accounting={version:1,context:{...f.request.context,deadlineAt:at+1000},accounting:'in-memory-host-declared-cost-holds-not-vendor-billing',vendorBillingVerified:false,
   blocked:false,callsConsumed:1,audioMsConsumed:6000,heldCostMicros:100000,entries:[{callId:'asr-1',audioMs:6000,reservedCostMicros:100000,status:'dispatched'}]};
  db.query('UPDATE speech_tasks SET snapshot=?,version=?,fence=?').run(JSON.stringify(s),s.version,'crashed-claim');db.close();
  at+=1001;m=createSpeechTaskManager(deps);const recovered=await m.snapshot(f.request.speechId,f.owner);
  expect(recovered.status).toBe('interrupted');expect(recovered.accounting?.entries[0]?.status).toBe('unknown');
  await m.upload(f.request.speechId,f.owner,f.wavBytes);expect(calls).toBe(0);
 }finally{m.close();t.clean();}
});
test('remote cancellation keeps the occupied slot until its original worker settles',async()=>{
 const t=temporary(),f=speechTaskFixture();let release!:(v:unknown)=>void,calls=0;
 const deps={path:t.path,maxRunning:1,authorize:async()=>true,providerFor:()=>({...f.provider,transcribe:async()=>{
  calls++;if(calls===1)return new Promise<unknown>(r=>{release=r;});return{text:f.text,language:'zh-CN',segments:[]};
 }})};
 const a=createSpeechTaskManager(deps),b=createSpeechTaskManager(deps),next={...f.request,speechId:'speech-next',context:{...f.request.context,runId:'speech-next'},binding:{...f.request.binding,answerId:'next-answer'}};
 try{await a.create(f.request);await a.upload(f.request.speechId,f.owner,f.wavBytes);await new Promise(r=>setTimeout(r,0));await b.cancel(f.request.speechId,f.owner);
  await b.create(next);await expect(b.upload(next.speechId,f.owner,f.wavBytes)).rejects.toThrow('RATE_LIMITED');
  release({text:f.text,language:'zh-CN',segments:[]});await a.wait(f.request.speechId);
  await b.upload(next.speechId,f.owner,f.wavBytes);await b.wait(next.speechId);expect(calls).toBe(2);
 }finally{release?.({text:f.text,language:'zh-CN',segments:[]});await a.wait(f.request.speechId);await b.wait(next.speechId);a.close();b.close();t.clean();}
});
test('critical SQLite accounting write failure prevents HTTP, rather than publishing a successful task',async()=>{
 const t=temporary(),f=speechTaskFixture();let calls=0;
 const m=createSpeechTaskManager({path:t.path,authorize:async()=>true,providerFor:({context,onCheckpoint})=>createAsrProvider({...config,enabled:true,authorization:{allowLive:true,expiresAt:Date.now()+60000}},
  {context,onCheckpoint,readCredential:()=> 'synthetic',fetch:async()=>{calls++;return new Response();}})});
 try{await m.create(f.request);const db=new Database(t.path);db.exec("CREATE TRIGGER reject_accounting BEFORE UPDATE ON speech_tasks WHEN json_extract(NEW.snapshot,'$.accounting') IS NOT NULL BEGIN SELECT RAISE(FAIL,'injected write failure'); END;");db.close();
  await m.upload(f.request.speechId,f.owner,f.wavBytes);await m.wait(f.request.speechId);
  expect((await m.snapshot(f.request.speechId,f.owner)).status).toBe('failed');expect(calls).toBe(0);
 }finally{m.close();t.clean();}
});
test('semantic answer binding and capacity cannot be bypassed by a new speech ID; expired replay is explicit',async()=>{
 const t=temporary(),f=speechTaskFixture();let at=Date.now();
 const m=createSpeechTaskManager({path:t.path,now:()=>at,maxTasks:1,authorize:async()=>true,providerFor:()=>f.provider});
 try{await m.create(f.request);
  const other={...f.request,speechId:'new-id',context:{...f.request.context,runId:'new-id'}};
  await expect(m.create(other)).rejects.toThrow('VERSION_CONFLICT');
  await expect(m.create({...other,binding:{...other.binding,answerId:'other-answer'}})).rejects.toThrow('RATE_LIMITED');
  at=f.request.context.deadlineAt+1;expect((await m.create(f.request)).status).toBe('failed');
 }finally{m.close();t.clean();}
});
