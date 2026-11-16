import {Database} from 'bun:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,existsSync,lstatSync} from 'node:fs';import {resolve,dirname} from 'node:path';
import {SpeechTaskCreateSchema,SpeechTaskSnapshotSchema,SpeechOwnerSchema,SpeechTaskConfirmationSchema,SpeechTaskIdSchema,
 type SpeechTaskCreate,type SpeechTaskSnapshot,type SpeechOwner} from '../../../../packages/contracts/src/speech-task.ts';
import {AsrAccountingSchema,type AsrAccounting} from '../../../../packages/contracts/src/asr-service.ts';
import type {ToolContext} from '../../../../packages/contracts/src/tools.ts';
import {workflowCommitDigest as digest} from '../../../../packages/agent-client/src/workflow-commit.ts';
import {AgentStateError} from '../planning/interview-state.ts';
import {inspectWav} from './wav.ts';
import {transcribeSpeech,type SpeechProvider} from './transcribe.ts';
import {confirmSpeechAnswer} from './confirm.ts';
import type{ExpressionAssessment}from'../../../../packages/contracts/src/expression-assessment.ts';
import type{SpeechTranscript}from'../../../../packages/contracts/src/speech.ts';
type Operation='create'|'read'|'upload'|'confirm'|'cancel';
interface Options {path:string;now?:()=>number;maxTasks?:number;maxRunning?:number;
 authorize:(input:{operation:Operation;request:SpeechTaskCreate})=>boolean|Promise<boolean>;
 providerFor:(input:{context:ToolContext;request:SpeechTaskCreate;onCheckpoint:(s:AsrAccounting)=>void})=>SpeechProvider;
 assessExpression?:(input:{context:ToolContext;request:SpeechTaskCreate;wavBytes:Uint8Array;transcript:SpeechTranscript},signal:AbortSignal)=>Promise<ExpressionAssessment>;}
type Row={speech_id:string;digest:string;binding_key:string;version:number;fence:string|null;confirmation_digest:string|null;snapshot:string};
function fail(code:ConstructorParameters<typeof AgentStateError>[0]):never{throw new AgentStateError(code);}
function uncertain(s:SpeechTaskSnapshot){
 if(!s.accounting)return undefined;const a=structuredClone(s.accounting);
 for(const entry of a.entries)if(entry.status==='dispatched')entry.status='unknown';
 a.blocked||=a.entries.some(e=>e.status==='unknown');return a;
}
/** SQLite operation candidates only; mandatory host authorization does not replace business identity/commits. */
export function createSpeechTaskManager(options:Options){
 const maxTasks=options.maxTasks??32,maxRunning=options.maxRunning??4;
 if(typeof options.authorize!=='function'||typeof options.providerFor!=='function'||!options.path||!Number.isInteger(maxTasks)||maxTasks<1||maxTasks>1000||
  !Number.isInteger(maxRunning)||maxRunning<1||maxRunning>8)fail('VALIDATION_ERROR');
 const file=resolve(options.path);mkdirSync(dirname(file),{recursive:true});if(existsSync(file)&&lstatSync(file).isSymbolicLink())fail('VALIDATION_ERROR');
 const db=new Database(file,{create:true,strict:true});db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
 db.exec(`CREATE TABLE IF NOT EXISTS speech_tasks(speech_id TEXT PRIMARY KEY,digest TEXT NOT NULL,binding_key TEXT UNIQUE NOT NULL,version INTEGER NOT NULL,fence TEXT,confirmation_digest TEXT,snapshot TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS speech_meta(name TEXT PRIMARY KEY,value INTEGER NOT NULL);`);
 let closed=false,authorizations=0;const pending=new Map<string,Promise<void>>(),controllers=new Map<string,AbortController>();
 const ingress=new Set<symbol>(),uploads=new Set<string>();
 const clock=()=>{if(closed)fail('DEPENDENCY_UNAVAILABLE');const at=(options.now??Date.now)();
  if(!Number.isSafeInteger(at)||at<0)fail('VALIDATION_ERROR');
  if(!db.query("INSERT INTO speech_meta VALUES('clock',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value WHERE value<=excluded.value RETURNING value").get(at))fail('VALIDATION_ERROR');return at;};
 const row=(id:string)=>{if(!SpeechTaskIdSchema.safeParse(id).success)fail('VALIDATION_ERROR');
  const r=db.query('SELECT * FROM speech_tasks WHERE speech_id=?').get(id) as Row|null;return r??fail('NOT_FOUND');};
 const snapshot=(r:Row)=>{const s=SpeechTaskSnapshotSchema.parse(JSON.parse(r.snapshot));
  if(s.request.speechId!==r.speech_id||s.version!==r.version||digest(s.request)!==r.digest)fail('DEPENDENCY_UNAVAILABLE');return s;};
 const save=(r:Row,next:SpeechTaskSnapshot,extra:{fence?:string|null;confirmationDigest?:string|null}={})=>{
  const value=SpeechTaskSnapshotSchema.parse({...next,version:r.version+1,updatedAt:clock()});
  const changed=db.query('UPDATE speech_tasks SET version=?,fence=?,confirmation_digest=?,snapshot=? WHERE speech_id=? AND version=?').run(
   value.version,extra.fence===undefined?r.fence:extra.fence,extra.confirmationDigest===undefined?r.confirmation_digest:extra.confirmationDigest,
   JSON.stringify(value),r.speech_id,r.version);
  if(changed.changes!==1)fail('VERSION_CONFLICT');return value;
 };
 const recover=(id:string)=>db.transaction(()=>{const r=row(id),s=snapshot(r),at=clock();
  const expired=s.status==='running'&&at>=(s.executionDeadlineAt??s.request.context.deadlineAt);
  if(expired||s.status==='awaiting_audio'&&at>=s.request.context.deadlineAt)
   return save(r,{...s,status:expired?'interrupted':'failed',errorCode:'DEADLINE_EXCEEDED',...(s.accounting?{accounting:uncertain(s)!}:{})},{fence:null});
  if(r.fence&&s.executionDeadlineAt!==undefined&&at>=s.executionDeadlineAt)
   return save(r,{...s,...(s.accounting?{accounting:uncertain(s)!}:{})},{fence:null});
  return s;
 }).immediate();
 const owned=async(id:string,rawOwner:unknown,operation:Operation)=>{
  clock();const owner=SpeechOwnerSchema.safeParse(rawOwner);if(!owner.success)fail('VALIDATION_ERROR');
  const s=snapshot(row(id));if(s.request.context.userId!==owner.data.userId)fail('FORBIDDEN');if(s.request.context.roleId!==owner.data.roleId)fail('ROLE_FORBIDDEN');
  await authorize(s.request,operation);return recover(id);
 };
 async function authorize(request:SpeechTaskCreate,operation:Operation){
  authorizations++;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{const allowed=await Promise.race([Promise.resolve().then(()=>options.authorize({operation,request:structuredClone(request)})),
   new Promise<never>((_r,reject)=>{timer=setTimeout(()=>reject(new AgentStateError('DEADLINE_EXCEEDED')),1000);})]);
   if(allowed!==true)fail('FORBIDDEN');
  }catch(e){if(e instanceof AgentStateError)throw e;fail('DEPENDENCY_UNAVAILABLE');}finally{authorizations--;if(timer!==undefined)clearTimeout(timer);}
 }
 const executionContext=(s:SpeechTaskSnapshot)=>({...s.request.context,deadlineAt:s.executionDeadlineAt!});
 const checkpoint=(id:string,fence:string,raw:AsrAccounting)=>db.transaction(()=>{
  const r=row(id),s=snapshot(r);if(r.fence!==fence||s.status!=='running'||clock()>=s.executionDeadlineAt!)fail('DEPENDENCY_UNAVAILABLE');
  const a=AsrAccountingSchema.parse(raw);if(digest(a.context)!==digest(executionContext(s)))fail('VALIDATION_ERROR');
  save(r,{...s,accounting:a});
 }).immediate();
 async function execute(id:string,fence:string,bytes:Uint8Array,controller:AbortController){
  try{
   const start=snapshot(row(id));if(row(id).fence!==fence||start.status!=='running')return;
   const context=executionContext(start),provider=options.providerFor({context:structuredClone(context),request:structuredClone(start.request),onCheckpoint:s=>checkpoint(id,fence,s)});
   const transcript=await transcribeSpeech({context,transcriptionId:`transcript-${id}`,audioId:id,wavBytes:bytes},{provider,...(options.now?{now:options.now}:{}),timeoutMs:30000},controller.signal);
   let expressionAssessment:ExpressionAssessment|undefined,expressionError:ConstructorParameters<typeof AgentStateError>[0]|undefined;
   if(options.assessExpression){let timer:ReturnType<typeof setTimeout>|undefined;
    try{expressionAssessment=await Promise.race([options.assessExpression({context,request:structuredClone(start.request),wavBytes:new Uint8Array(bytes),transcript:structuredClone(transcript)},controller.signal),
     new Promise<never>((_r,reject)=>{timer=setTimeout(()=>reject(new AgentStateError('DEADLINE_EXCEEDED')),Math.max(1,Math.min(8000,context.deadlineAt-clock())));})]);}
    catch(e){expressionError=e instanceof AgentStateError?e.code:'DEPENDENCY_UNAVAILABLE';}finally{if(timer!==undefined)clearTimeout(timer);}
   }
   db.transaction(()=>{const r=row(id),s=snapshot(r);if(r.fence!==fence||s.status!=='running')return;
    if(clock()>=s.executionDeadlineAt!)fail('DEADLINE_EXCEEDED');save(r,{...s,status:'transcribed',transcript,...(expressionAssessment?{expressionAssessment}:{}),...(expressionError?{expressionError}:{})},{fence:null});}).immediate();
  }catch(e){
   db.transaction(()=>{const r=row(id),s=snapshot(r);if(r.fence!==fence||s.status!=='running')return;
    save(r,{...s,status:'failed',errorCode:e instanceof AgentStateError?e.code:'DEPENDENCY_UNAVAILABLE',...(s.accounting?{accounting:uncertain(s)!}:{})},{fence:null});}).immediate();
  }finally{controllers.delete(id);db.query('UPDATE speech_tasks SET fence=NULL WHERE speech_id=? AND fence=?').run(id,fence);}
 }
 for(const r of db.query('SELECT speech_id FROM speech_tasks').all() as {speech_id:string}[])recover(r.speech_id);
 return {
  acquireHttpSlot(uploadId?:string){
   clock();if(uploadId!==undefined&&!SpeechTaskIdSchema.safeParse(uploadId).success)fail('VALIDATION_ERROR');
   if(ingress.size>=maxRunning||uploadId!==undefined&&uploads.has(uploadId))fail('RATE_LIMITED');
   const permit=Symbol();ingress.add(permit);if(uploadId!==undefined)uploads.add(uploadId);let released=false;
   return()=>{if(released)return;released=true;ingress.delete(permit);if(uploadId!==undefined)uploads.delete(uploadId);};
  },
  async create(raw:unknown){clock();const p=SpeechTaskCreateSchema.safeParse(raw);if(!p.success)return fail('VALIDATION_ERROR');const req=p.data;
   await authorize(req,'create');
   return db.transaction(()=>{
    const existing=db.query('SELECT * FROM speech_tasks WHERE speech_id=?').get(req.speechId) as Row|null;
    if(existing){if(existing.digest!==digest(req))fail('VERSION_CONFLICT');return recover(req.speechId);}
    const at=clock();if(req.context.deadlineAt<=at||req.context.deadlineAt>at+600000)fail('DEADLINE_EXCEEDED');
    const key=digest({userId:req.context.userId,roleId:req.context.roleId,sessionId:req.binding.sessionId,questionId:req.binding.questionId,answerId:req.binding.answerId});
    if(db.query('SELECT 1 FROM speech_tasks WHERE binding_key=?').get(key))fail('VERSION_CONFLICT');
    if((db.query('SELECT COUNT(*) AS n FROM speech_tasks').get() as {n:number}).n>=maxTasks)fail('RATE_LIMITED');
    const s=SpeechTaskSnapshotSchema.parse({schemaVersion:1,kind:'uncommitted-speech-task',request:req,version:0,status:'awaiting_audio',createdAt:at,updatedAt:at});
    db.query('INSERT INTO speech_tasks VALUES(?,?,?,?,NULL,NULL,?)').run(req.speechId,digest(req),key,0,JSON.stringify(s));return s;
   }).immediate();
  },
  snapshot:(id:string,owner:SpeechOwner)=>owned(id,owner,'read'),
  async upload(id:string,owner:SpeechOwner,input:Uint8Array,signal?:AbortSignal){
   if(signal?.aborted)fail('RUN_CANCELLED');const initial=await owned(id,owner,'read');
   inspectWav(input);const bytes=new Uint8Array(input);
   if(bytes.length!==initial.request.audio.byteLength||createHash('sha256').update(bytes).digest('hex')!==initial.request.audio.sha256)fail('VERSION_CONFLICT');
   if(initial.status!=='awaiting_audio')return initial;
   await authorize(initial.request,'upload');if(signal?.aborted)fail('RUN_CANCELLED');
   const claim=db.transaction(()=>{const r=row(id),s=snapshot(r),at=clock();if(s.status!=='awaiting_audio')return{snapshot:s,fence:null};
    if(at>=s.request.context.deadlineAt)fail('DEADLINE_EXCEEDED');
    for(const task of db.query('SELECT speech_id FROM speech_tasks WHERE fence IS NOT NULL').all() as {speech_id:string}[])recover(task.speech_id);
    const running=(db.query('SELECT COUNT(*) AS n FROM speech_tasks WHERE fence IS NOT NULL').get() as {n:number}).n;
    if(running>=maxRunning)fail('RATE_LIMITED');const fence=randomUUID();
    return{snapshot:save(r,{...s,status:'running',executionDeadlineAt:Math.min(at+30000,s.request.context.deadlineAt)},{fence}),fence};
   }).immediate();
   if(claim.fence){const ctl=new AbortController();controllers.set(id,ctl);
    const work=Promise.resolve().then(()=>execute(id,claim.fence!,bytes,ctl)).finally(()=>pending.delete(id));pending.set(id,work);void work.catch(()=>{});}
   return claim.snapshot;
  },
  async confirm(id:string,owner:SpeechOwner,raw:unknown){
   const p=SpeechTaskConfirmationSchema.safeParse(raw);if(!p.success)fail('VALIDATION_ERROR');
   await owned(id,owner,'confirm');const command=p.data;
   return db.transaction(()=>{const r=row(id),s=snapshot(r),key=digest(command);
    if(s.status==='confirmed'){if(r.confirmation_digest!==key)fail('VERSION_CONFLICT');return s;}
    if(s.status!=='transcribed'||command.expectedVersion!==s.version)fail('VERSION_CONFLICT');
    const at=clock();if(at>=s.request.context.deadlineAt)fail('DEADLINE_EXCEEDED');const t=s.transcript!;
    const answer=confirmSpeechAnswer(t,{transcriptionId:t.transcriptionId,audioSha256:t.audio.sha256,userId:s.request.context.userId,roleId:s.request.context.roleId,
     answerId:s.request.binding.answerId,text:command.text,confirmedAt:at});
    return save(r,{...s,status:'confirmed',answer},{confirmationDigest:key});
   }).immediate();
  },
  async cancel(id:string,owner:SpeechOwner){
   await owned(id,owner,'cancel');const result=db.transaction(()=>{const r=row(id),s=snapshot(r);
    if(!['awaiting_audio','running'].includes(s.status))return s;
    return save(r,{...s,status:'cancelled',errorCode:'RUN_CANCELLED',...(s.accounting?{accounting:uncertain(s)!}:{})});
   }).immediate();controllers.get(id)?.abort();return result;
  },
  async wait(id:string){await pending.get(id);},
  close(){if(closed)return;if(pending.size||authorizations||ingress.size)fail('DEPENDENCY_UNAVAILABLE');db.close();closed=true;},
 };
}
export type SpeechTaskManager=ReturnType<typeof createSpeechTaskManager>;
