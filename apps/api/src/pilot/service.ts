import {Database} from 'bun:sqlite';import {randomBytes,randomUUID,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
import {mkdirSync,existsSync,lstatSync} from 'node:fs';import {resolve,dirname} from 'node:path';import {z} from 'zod';
import {AgentRunRequestSchema,type AgentRunRequest,type AgentRunSnapshot} from '../../../../packages/contracts/src/agent-run.ts';
import {WorkflowSchema,type InterviewWorkflow} from '../../../../packages/contracts/src/session-workflow.ts';
import {MemorySnapshotSchema,type MemorySnapshot} from '../../../../packages/contracts/src/memory.ts';
import {PilotLoginSchema,PilotSessionCreateSchema,PilotCommandSchema,PilotAnswerSchema,PilotSpeechCreateSchema,PilotSpeechConfirmSchema,
 PilotSessionViewSchema,PilotSpeechViewSchema,type PilotSessionView,type PilotReport} from '../../../../packages/contracts/src/workbench.ts';
import {SpeechTaskSnapshotSchema,type SpeechTaskCreate,type SpeechOwner} from '../../../../packages/contracts/src/speech-task.ts';
import {createWorkflowCommitTicket,prepareWorkflowCommit,workflowCommitDigest as digest} from '../../../../packages/agent-client/src/workflow-commit.ts';
import {ErrorCodeSchema,type RoleId,type ErrorCode} from '../../../../packages/contracts/src/tools.ts';
import {PilotError as AgentStateError} from './error.ts';
interface SpeechGateway {create:(request:SpeechTaskCreate)=>Promise<unknown>;upload:(id:string,owner:SpeechOwner,bytes:Uint8Array)=>Promise<unknown>;
 get:(id:string,owner:SpeechOwner)=>Promise<unknown>;confirm:(id:string,owner:SpeechOwner,command:unknown)=>Promise<unknown>;cancel:(id:string,owner:SpeechOwner)=>Promise<unknown>}
export interface PilotOptions {path:string;users:{userId:string;name:string;password:string}[];evidenceMode:'offline-fixture'|'live-model';allowDraftKnowledge:boolean;
 run:(request:AgentRunRequest)=>Promise<AgentRunSnapshot>;getRun?:(id:string)=>Promise<AgentRunSnapshot>;
 speech?:SpeechGateway;questionAudio?:(input:{sessionId:string;userId:string;roleId:RoleId;questionId:string;text:string;deadlineAt:number})=>Promise<Uint8Array>;
 onSession?:(input:{sessionId:string;userId:string;roleId:RoleId;deadlineAt:number})=>void;evidenceStatus?:()=>unknown;now?:()=>number;
 onDiagnostic?:(input:{operationId:string;errorCode:string})=>void;}
type SessionRow={session_id:string;user_id:string;role_id:RoleId;storage_version:number;workflow:string|null;created_at:number;updated_at:number;deadline_at:number};
type OperationRow={operation_id:string;user_id:string;session_id:string;command_digest:string;request:string;ticket:string;status:string;error_code:string|null;receipt:string|null;created_at:number;deadline_at:number};
const Id=z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/);
function fail(code:ErrorCode):never{throw new AgentStateError(code);}
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
export const pilotRoles=[{id:'java-backend' as const,label:'Java 后端',skills:['Spring事务','Java并发','项目设计','协作表达']},
 {id:'web-frontend' as const,label:'Web 前端',skills:['React异步','浏览器网络','项目设计','协作表达']}];
const skillMap:Record<RoleId,Record<string,string>>={'java-backend':{'spring-transactions':'Spring事务','java-concurrency':'Java并发','project-design':'项目设计','collaboration':'协作表达'},
 'web-frontend':{'react-async':'React异步','browser-network':'浏览器网络','project-design':'项目设计','collaboration':'协作表达'}};
function safeCode(e:unknown):ErrorCode{const p=ErrorCodeSchema.safeParse((e as {code?:unknown}|null)?.code);return p.success?p.data:'DEPENDENCY_UNAVAILABLE';}
export function createPilotService(options:PilotOptions){
 if(!options.users.length||options.users.some(u=>!Id.safeParse(u.userId).success||u.password.length<12||u.password.length>256))fail('VALIDATION_ERROR');
 const file=resolve(options.path);mkdirSync(dirname(file),{recursive:true});if(existsSync(file)&&lstatSync(file).isSymbolicLink())fail('VALIDATION_ERROR');
 const db=new Database(file,{create:true,strict:true});db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
 db.exec(`CREATE TABLE IF NOT EXISTS pilot_users(user_id TEXT PRIMARY KEY,name TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS pilot_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS pilot_login_limits(user_id TEXT PRIMARY KEY,failures INTEGER NOT NULL,locked_until INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS pilot_sessions(session_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,role_id TEXT NOT NULL,storage_version INTEGER NOT NULL,workflow TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,deadline_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS pilot_memory(user_id TEXT NOT NULL,role_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(user_id,role_id));
 CREATE TABLE IF NOT EXISTS pilot_operations(operation_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT NOT NULL,command_digest TEXT NOT NULL,request TEXT NOT NULL,ticket TEXT NOT NULL,status TEXT NOT NULL,error_code TEXT,receipt TEXT,created_at INTEGER NOT NULL,deadline_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS pilot_speech(speech_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT NOT NULL,answer_id TEXT NOT NULL,question_id TEXT NOT NULL,session_revision INTEGER NOT NULL,prefix_text TEXT,snapshot TEXT,request TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS pilot_audio(cache_key TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT NOT NULL,audio BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS pilot_meta(name TEXT PRIMARY KEY,value INTEGER NOT NULL);`);
 for(const u of options.users){const old=db.query('SELECT * FROM pilot_users WHERE user_id=?').get(u.userId) as {salt:string;password_hash:string}|null;
  if(old&&timingSafeEqual(scryptSync(u.password,old.salt,32),Buffer.from(old.password_hash,'hex')))continue;
  const salt=randomBytes(16).toString('hex'),hash=scryptSync(u.password,salt,32).toString('hex');
  db.transaction(()=>{db.query('INSERT INTO pilot_users VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,salt=excluded.salt,password_hash=excluded.password_hash').run(u.userId,u.name,salt,hash);
   db.query('DELETE FROM pilot_tokens WHERE user_id=?').run(u.userId);}).immediate();}
 // The configured user set is the operator's allowlist; removing a user revokes old tokens.
 for(const r of db.query('SELECT user_id FROM pilot_users').all() as {user_id:string}[])if(!options.users.some(u=>u.userId===r.user_id)){
  db.query('DELETE FROM pilot_tokens WHERE user_id=?').run(r.user_id);db.query('DELETE FROM pilot_users WHERE user_id=?').run(r.user_id);}
 let closed=false;const pending=new Map<string,Promise<void>>(),speechPending=new Set<string>();
 const now=()=>{if(closed)fail('DEPENDENCY_UNAVAILABLE');const at=(options.now??Date.now)();if(!Number.isSafeInteger(at)||at<0)fail('VALIDATION_ERROR');
  if(!db.query("INSERT INTO pilot_meta VALUES('clock',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value WHERE value<=excluded.value RETURNING value").get(at))fail('VALIDATION_ERROR');return at;};
 const session=(id:string,userId:string)=>{if(!Id.safeParse(id).success)fail('VALIDATION_ERROR');now();const r=db.query('SELECT * FROM pilot_sessions WHERE session_id=?').get(id) as SessionRow|null;
  if(!r) return fail('NOT_FOUND');if(r.user_id!==userId)fail('FORBIDDEN');return r;};
 const workflow=(r:SessionRow)=>r.workflow?WorkflowSchema.parse(JSON.parse(r.workflow)):null;
 const memoryFor=(userId:string,roleId:RoleId)=>{const r=db.query('SELECT body FROM pilot_memory WHERE user_id=? AND role_id=?').get(userId,roleId) as {body:string}|null;
  return r?MemorySnapshotSchema.parse(JSON.parse(r.body)):MemorySnapshotSchema.parse({schemaVersion:1,kind:'uncommitted-memory-snapshot',userId,roleId,version:0,updatedAt:now(),sessions:[]});};
 function operation(id:string,userId:string){now();const r=db.query('SELECT * FROM pilot_operations WHERE operation_id=?').get(id) as OperationRow|null;
  if(!r)return fail('NOT_FOUND');if(r.user_id!==userId)fail('FORBIDDEN');return r;}
 const opView=(r:OperationRow)=>({operationId:r.operation_id,sessionId:r.session_id,status:r.status as 'running'|'completed'|'failed'|'interrupted',errorCode:r.error_code});
 function finishOperation(row:OperationRow,run:AgentRunSnapshot){
  db.transaction(()=>{const current=operation(row.operation_id,row.user_id);if(current.status!=='running')return;
   const r=session(row.session_id,row.user_id),w=workflow(r),request=AgentRunRequestSchema.parse(JSON.parse(row.request)),ticket=JSON.parse(row.ticket),memory=memoryFor(r.user_id,r.role_id);
   const decision=prepareWorkflowCommit({ticket,request,run,current:{session:w?{storageVersion:r.storage_version,workflow:w}:null,memory},receipt:null,now:now()});
   if(decision.kind!=='uncommitted-workflow-commit-plan')fail('VERSION_CONFLICT');
   const changed=db.query('UPDATE pilot_sessions SET workflow=?,storage_version=?,updated_at=? WHERE session_id=? AND storage_version=?').run(
    JSON.stringify(decision.sessionWrite.workflow),decision.sessionWrite.storageVersion,now(),r.session_id,r.storage_version);
   if(changed.changes!==1)fail('VERSION_CONFLICT');if(decision.memoryWrite)db.query('UPDATE pilot_memory SET body=? WHERE user_id=? AND role_id=?').run(JSON.stringify(decision.memoryWrite),r.user_id,r.role_id);
   db.query("UPDATE pilot_operations SET status='completed',receipt=? WHERE operation_id=? AND status='running'").run(JSON.stringify(decision.receiptCandidate),row.operation_id);
  }).immediate();
 }
 function launch(row:OperationRow,recoverOnly=false){
  const work=Promise.resolve().then(async()=>{try{const request=AgentRunRequestSchema.parse(JSON.parse(row.request));
    const run=recoverOnly?await options.getRun?.(request.context.runId):await options.run(request);
    if(!run||run.status!=='completed')fail('DEPENDENCY_UNAVAILABLE');finishOperation(row,run);
   }catch(e){const c=(e as {code?:unknown}|null)?.code;try{options.onDiagnostic?.({operationId:row.operation_id,errorCode:typeof c==='string'&&/^[A-Z_]{1,100}$/.test(c)?c:'DEPENDENCY_UNAVAILABLE'});}catch{}
    db.query("UPDATE pilot_operations SET status=?,error_code=? WHERE operation_id=? AND status='running'").run(recoverOnly?'interrupted':'failed',safeCode(e),row.operation_id);}
  }).finally(()=>pending.delete(row.operation_id));pending.set(row.operation_id,work);void work.catch(()=>{});
 }
 function enqueue(userId:string,id:string,action:'create'|'plan'|'answer'|'finish',command:unknown,sessionId:string,make:(r:SessionRow)=>AgentRunRequest){
  const row=db.transaction(()=>{const existing=db.query('SELECT * FROM pilot_operations WHERE operation_id=?').get(id) as OperationRow|null;
   const commandDigest=digest({userId,sessionId,action,command});if(existing){if(existing.user_id!==userId||existing.command_digest!==commandDigest)fail('VERSION_CONFLICT');return existing;}
   const r=session(sessionId,userId);if(db.query("SELECT 1 FROM pilot_operations WHERE session_id=? AND status='running'").get(sessionId))fail('VERSION_CONFLICT');
   const request=AgentRunRequestSchema.parse(make(r)),w=workflow(r),at=now(),memory=memoryFor(userId,r.role_id);
   const ticket=createWorkflowCommitTicket({identity:{userId,roleId:r.role_id},request,operationId:id,taskId:`task-${id}`,leaseVersion:1,
    expectedStorageVersion:w?r.storage_version:null,expectedMemoryVersion:memory.version,issuedAt:at,leaseUntil:request.context.deadlineAt});
   db.query('INSERT INTO pilot_operations VALUES(?,?,?,?,?,?,?,NULL,NULL,?,?)').run(id,userId,sessionId,commandDigest,JSON.stringify(request),JSON.stringify(ticket),'running',at,request.context.deadlineAt);
   return operation(id,userId);
  }).immediate();if(row.status==='running'&&!pending.has(id))launch(row);return{operationId:id,sessionId:row.session_id};
 }
 const context=(r:SessionRow,id:string)=>({userId:r.user_id,roleId:r.role_id,runId:`api-${id}`,attemptId:'attempt-1',deadlineAt:Math.min(r.deadline_at,now()+60000)});
 function boundSpeech(raw:unknown,request:SpeechTaskCreate){const s=SpeechTaskSnapshotSchema.parse(raw);if(digest(s.request)!==digest(request))fail('VERSION_CONFLICT');return s;}
 function priorClarification(w:InterviewWorkflow){if(w.phase!=='awaiting_answer'||!w.current||w.turns.some(t=>t.input.question.id===w.current!.question.id))return null;
  const last=w.clarificationAttempts?.filter(a=>a.input.question.id===w.current!.question.id).at(-1);return last?.resolution.status==='needs_clarification'?last:null;}
 function reportView(w:InterviewWorkflow):PilotReport|null{const report=w.closeout?.report;if(!report)return null;
  return{evidenceMode:report.evidenceMode,coverage:{totalAnswers:report.coverage.totalAnswers,scoredAnswers:report.coverage.scoredAnswers??report.assessments.length,unscoredAnswers:report.coverage.unscoredAnswers??0},
   skills:report.skills.map(s=>({skillId:s.skillId,label:s.label,mastery:s.mastery,confidence:s.confidence})),
   answers:report.assessments.map(a=>({questionId:a.questionId,questionText:a.presentedText??a.questionText,strengths:a.feedback.strengths,improvements:a.feedback.improvements,
    criteria:a.evaluation.dimensions.map(d=>({id:d.criterionId,label:a.rubric.criteria.find(c=>c.id===d.criterionId)?.description??d.criterionId,score:d.score,maxScore:a.rubric.criteria.find(c=>c.id===d.criterionId)?.maxScore??1,
     action:a.criterionFeedback?.find(c=>c.criterionId===d.criterionId)?.action??null}))})),
   studyPlan:report.studyPlan.map(p=>({skillId:p.skillId,label:p.label,minutes:p.minutes,actions:p.actions})),unscoredAnswers:(report.unscoredAnswers??[]).map(a=>({questionId:a.questionId,reason:a.reason})),
   warnings:[...report.warnings,'评分语义与表达质量需独立人工审核'],expression:{status:report.expression.status,summary:report.expression.status==='audio_descriptions'?
    report.expression.answers.map(a=>`语音${a.audio.durationMs/1000}秒，内部停顿候选${a.features.audio.internalPauses.length}次；不是心理自信或情绪评分。`):['没有已确认语音，表达维度未评估。']}};
 }
 for(const op of db.query("SELECT * FROM pilot_operations WHERE status='running'").all() as OperationRow[])launch(op,true);
 return {
  roles:()=>pilotRoles,
  login(raw:unknown){const p=PilotLoginSchema.safeParse(raw);if(!p.success)fail('VALIDATION_ERROR');const {userId,password}=p.data!,at=now();
   const limits=db.query('SELECT * FROM pilot_login_limits WHERE user_id=?').get(userId) as {failures:number;locked_until:number}|null;if(limits&&limits.locked_until>at)fail('RATE_LIMITED');
   const u=db.query('SELECT * FROM pilot_users WHERE user_id=?').get(userId) as {name:string;salt:string;password_hash:string}|null;
   const actual=scryptSync(password,u?.salt??'unknown-user-dummy',32),expected=u?Buffer.from(u.password_hash,'hex'):Buffer.alloc(32);
   if(!u||!timingSafeEqual(actual,expected)){const n=(limits?.failures??0)+1;db.query('INSERT INTO pilot_login_limits VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET failures=excluded.failures,locked_until=excluded.locked_until').run(userId,n,n>=5?at+60000:0);fail('UNAUTHENTICATED');}
   db.query('DELETE FROM pilot_login_limits WHERE user_id=?').run(userId);const token=randomBytes(32).toString('base64url'),expiresAt=at+3600000;
   db.query('INSERT INTO pilot_tokens VALUES(?,?,?)').run(sha(token),userId,expiresAt);return{user:{userId,name:u.name},token,expiresAt};
  },
  authenticate(header:string|null){const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(header??'');if(!match) return fail('UNAUTHENTICATED');
   const r=db.query('SELECT user_id FROM pilot_tokens WHERE token_hash=? AND expires_at>?').get(sha(match[1]!),now()) as {user_id:string}|null;return r?.user_id??fail('UNAUTHENTICATED');},
  logout(header:string|null){if(header?.startsWith('Bearer '))db.query('DELETE FROM pilot_tokens WHERE token_hash=?').run(sha(header.slice(7)));},
  getSession(userId:string,id:string):PilotSessionView{const r=session(id,userId),w=workflow(r),prior=w?priorClarification(w):null;
   const issued=w?.issuedQuestions.at(-1)?.content;
   return PilotSessionViewSchema.parse({sessionId:id,roleId:r.role_id,revision:w?.revision??-1,phase:w?.phase??'creating',startedAt:r.created_at,deadlineAt:r.deadline_at,
    question:w?.current?{id:w.current.question.id,text:issued?.text??w.current.question.text}:null,
    clarification:prior?{prompt:typeof prior.resolution.clarification==='string'?prior.resolution.clarification:'请补充说明你刚才的回答。',previousText:prior.input.answer.text}:null,
    answeredCount:w?(w.turns.length+(w.clarificationAttempts?.filter(a=>a.resolution.status==='abstained').length??0)):0,
    scoredCount:w?.turns.length??0,unscoredCount:w?.clarificationAttempts?.filter(a=>a.resolution.status==='abstained').length??0,report:w?reportView(w):null,
    evidenceMode:options.evidenceMode,knowledgeStatus:options.allowDraftKnowledge?'draft-pilot':'reviewed-only'});
  },
  listSessions(userId:string){return(db.query('SELECT session_id FROM pilot_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(userId) as {session_id:string}[]).map(r=>this.getSession(userId,r.session_id));},
  createSession(userId:string,raw:unknown){const p=PilotSessionCreateSchema.safeParse(raw);if(!p.success)fail('VALIDATION_ERROR');const c=p.data!;
   return db.transaction(()=>{const existing=db.query('SELECT * FROM pilot_operations WHERE operation_id=?').get(c.operationId) as OperationRow|null;
   if(existing){if(existing.user_id!==userId||existing.command_digest!==digest({userId,sessionId:existing.session_id,action:'create',command:c}))fail('VERSION_CONFLICT');return{sessionId:existing.session_id,operationId:c.operationId};}
   const sessionId=randomUUID(),at=now(),deadlineAt=at+c.durationMinutes*60000;
   db.query('INSERT INTO pilot_sessions VALUES(?,?,?,-1,NULL,?,?,?)').run(sessionId,userId,c.roleId,at,at,deadlineAt);
   const m=memoryFor(userId,c.roleId);db.query('INSERT INTO pilot_memory VALUES(?,?,?) ON CONFLICT DO NOTHING').run(userId,c.roleId,JSON.stringify(m));
   const admission:unknown=options.onSession?.({sessionId,userId,roleId:c.roleId,deadlineAt});
   if(admission&&typeof (admission as {then?:unknown}).then==='function'){void Promise.resolve(admission).catch(()=>{});fail('DEPENDENCY_UNAVAILABLE');}
   return enqueue(userId,c.operationId,'create',c,sessionId,r=>({inputSnapshotId:`input-${c.operationId}`,context:context(r,c.operationId),job:{type:'workflow',operation:{action:'create',config:{identity:{userId,roleId:c.roleId},
    session:{sessionId,roleId:c.roleId,durationMinutes:c.durationMinutes,skills:Object.keys(skillMap[c.roleId]).map((skillId,i)=>({skillId,relevance:1-i*.05}))},
    policy:{id:`pilot-${c.roleId}-${c.pressure?'pressure':'standard'}`,roleId:c.roleId,parameters:{maxFollowupDepth:c.pressure?2:1,maxTurns:6,wrapUpSeconds:45}},
    goal:c.goal,skillLabels:skillMap[c.roleId],memory:memoryFor(userId,c.roleId),allowDraftKnowledge:options.allowDraftKnowledge,now:now()}}}}));}).immediate();
  },
  nextQuestion(userId:string,id:string,raw:unknown){const p=PilotCommandSchema.safeParse(raw);if(!p.success)fail('VALIDATION_ERROR');const c=p.data!;
   return enqueue(userId,c.operationId,'plan',c,id,r=>{const w=workflow(r)??fail('VERSION_CONFLICT'),ctx=context(r,c.operationId);return{inputSnapshotId:`input-${c.operationId}`,context:ctx,job:{type:'workflow',operation:{action:'plan',snapshot:w,command:{identity:w.identity,expectedRevision:c.expectedRevision,context:ctx}}}};});},
  submitAnswer(userId:string,id:string,raw:unknown){const p=PilotAnswerSchema.safeParse(raw);if(!p.success)fail('VALIDATION_ERROR');const c=p.data!;
   return enqueue(userId,c.operationId,'answer',c,id,r=>{const w=workflow(r)??fail('VERSION_CONFLICT'),prior=priorClarification(w);let text=prior&&!c.text.startsWith(prior.input.answer.text+'\n补充：')?`${prior.input.answer.text}\n补充：${c.text}`:c.text,answerId:string=randomUUID(),speech;
    if(c.speechId){const record=this.speechRecord(userId,c.speechId);const s=SpeechTaskSnapshotSchema.parse(JSON.parse(record.snapshot??'null'));
     if(record.session_id!==id||record.question_id!==w.current?.question.id||record.session_revision!==w.revision||s.status!=='confirmed'||s.answer?.answer.text!==c.text)fail('VERSION_CONFLICT');
     answerId=record.answer_id;text=c.text;speech=s.answer;}
    const ctx=context(r,c.operationId);return{inputSnapshotId:`input-${c.operationId}`,context:ctx,job:{type:'workflow',operation:{action:'answer',snapshot:w,command:{identity:w.identity,expectedRevision:c.expectedRevision,context:ctx,
     observationId:prior?.resolution.observationId??randomUUID(),answer:{id:answerId,text},quality:.6,evidenceMode:options.evidenceMode,...(speech?{speech}:{})}}}};});},
  completeSession(userId:string,id:string,raw:unknown){const p=PilotCommandSchema.safeParse(raw);if(!p.success)fail('VALIDATION_ERROR');const c=p.data!;
   return enqueue(userId,c.operationId,'finish',c,id,r=>{const w=workflow(r)??fail('VERSION_CONFLICT');return{inputSnapshotId:`input-${c.operationId}`,context:context(r,c.operationId),job:{type:'workflow',operation:{action:'finish',snapshot:w,command:{identity:w.identity,expectedRevision:c.expectedRevision,mode:'user_stop',sourceGroupId:`pilot-${id}`}}}};});},
  getOperation:(userId:string,id:string)=>opView(operation(id,userId)),
  speechRecord(userId:string,id:string){now();const r=db.query('SELECT * FROM pilot_speech WHERE speech_id=?').get(id) as {speech_id:string;user_id:string;session_id:string;answer_id:string;question_id:string;session_revision:number;prefix_text:string|null;snapshot:string|null;request:string}|null;
   if(!r)return fail('NOT_FOUND');if(r.user_id!==userId)fail('FORBIDDEN');return r;},
  async createSpeech(userId:string,id:string,raw:unknown){const c=PilotSpeechCreateSchema.parse(raw),r=session(id,userId),w=workflow(r)??fail('VERSION_CONFLICT');if(w.revision!==c.expectedRevision||w.phase!=='awaiting_answer'||!w.current)fail('VERSION_CONFLICT');
   if(!options.speech)fail('NOT_IMPLEMENTED');const speechId=randomUUID(),answerId=randomUUID(),prior=priorClarification(w);
   const request:SpeechTaskCreate={speechId,context:{userId,roleId:r.role_id,runId:speechId,attemptId:'attempt-1',deadlineAt:Math.min(r.deadline_at,now()+600000)},
    binding:{sessionId:id,questionId:w.current.question.id,answerId,sessionVersion:w.revision},audio:{sha256:c.sha256,byteLength:c.byteLength}};
   db.query('INSERT INTO pilot_speech VALUES(?,?,?,?,?,?,?,NULL,?)').run(speechId,userId,id,answerId,w.current.question.id,w.revision,prior?.input.answer.text??null,JSON.stringify(request));
   const s=boundSpeech(await options.speech!.create(request),request);db.query('UPDATE pilot_speech SET snapshot=? WHERE speech_id=?').run(JSON.stringify(s),speechId);return{speechId};},
  async uploadSpeech(userId:string,id:string,bytes:Uint8Array){const r=this.speechRecord(userId,id),req:SpeechTaskCreate=JSON.parse(r.request);if(!options.speech)fail('NOT_IMPLEMENTED');
   const s=boundSpeech(await options.speech!.upload(id,{userId,roleId:req.context.roleId},bytes),req);db.query('UPDATE pilot_speech SET snapshot=? WHERE speech_id=?').run(JSON.stringify(s),id);return{speechId:id,status:s.status};},
  async getSpeech(userId:string,id:string){const r=this.speechRecord(userId,id),req:SpeechTaskCreate=JSON.parse(r.request);if(!options.speech)fail('NOT_IMPLEMENTED');
   const s=boundSpeech(await options.speech!.get(id,{userId,roleId:req.context.roleId}),req);db.query('UPDATE pilot_speech SET snapshot=? WHERE speech_id=?').run(JSON.stringify(s),id);
   return PilotSpeechViewSchema.parse({speechId:id,status:s.status,version:s.version,originalText:s.transcript?.originalText??null,confirmedText:s.answer?.answer.text??null,errorCode:s.errorCode??null,prefixText:r.prefix_text,
    expression:s.transcript?[`录音${s.transcript.audio.durationMs/1000}秒；内部停顿候选${s.transcript.expression.audio.internalPauses.length}次。`,
     ...(s.expressionAssessment?[`未验证模型观察（不计正式分）：${s.expressionAssessment.clarity.observation}`,s.expressionAssessment.confidentDelivery.observation,s.expressionAssessment.vocalValence.observation]:[]),
     ...(s.expressionError?[`表达模型暂未完成：${s.expressionError}；技术评价仍以确认文字为准。`]:[]),
     '清晰度、心理自信及情绪尚未通过可靠性验证，不给综合分。']:[]});},
  async confirmSpeech(userId:string,id:string,raw:unknown){const c=PilotSpeechConfirmSchema.parse(raw),r=this.speechRecord(userId,id),req:SpeechTaskCreate=JSON.parse(r.request);if(!options.speech)fail('NOT_IMPLEMENTED');
   const s=boundSpeech(await options.speech!.confirm(id,{userId,roleId:req.context.roleId},c),req);db.query('UPDATE pilot_speech SET snapshot=? WHERE speech_id=?').run(JSON.stringify(s),id);return this.getSpeech(userId,id);},
  async cancelSpeech(userId:string,id:string){const r=this.speechRecord(userId,id),req:SpeechTaskCreate=JSON.parse(r.request);if(!options.speech)fail('NOT_IMPLEMENTED');await options.speech!.cancel(id,{userId,roleId:req.context.roleId});return this.getSpeech(userId,id);},
  authorizeSpeech(input:{operation:string;request:SpeechTaskCreate}){try{const q=input.request,r=this.speechRecord(q.context.userId,q.speechId);if(digest(JSON.parse(r.request))!==digest(q))return false;
   const sessionRow=session(r.session_id,r.user_id),w=workflow(sessionRow);return input.operation==='read'||input.operation==='cancel'||!!w&&w.phase==='awaiting_answer'&&w.revision===r.session_revision&&w.current?.question.id===r.question_id&&now()<sessionRow.deadline_at;
  }catch{return false;}},
  authorizeVoice(input:{sessionId:string;userId:string;roleId:RoleId;questionId:string;text:string}){try{const r=session(input.sessionId,input.userId),w=workflow(r);
   return !!w?.current&&w.current.question.id===input.questionId&&r.role_id===input.roleId&&now()<r.deadline_at&&(w.issuedQuestions.at(-1)?.content?.text??w.current.question.text)===input.text;
  }catch{return false;}},
  async questionAudio(userId:string,id:string,questionId:string){const r=session(id,userId),w=workflow(r);if(!w?.current||w.current.question.id!==questionId)fail('VERSION_CONFLICT');if(!options.questionAudio)fail('NOT_IMPLEMENTED');
   const text=w.issuedQuestions.at(-1)?.content?.text??w.current!.question.text,key=digest({id,questionId,text}),cached=db.query('SELECT audio FROM pilot_audio WHERE cache_key=? AND user_id=?').get(key,userId) as {audio:Uint8Array}|null;
   if(cached)return new Uint8Array(cached.audio);if(speechPending.has(key))fail('RATE_LIMITED');speechPending.add(key);
   try{const audio=await options.questionAudio!({sessionId:id,userId,roleId:r.role_id,questionId,text,deadlineAt:r.deadline_at});if(audio.length>8*1024*1024)fail('CONTEXT_BUDGET_EXCEEDED');db.query('INSERT INTO pilot_audio VALUES(?,?,?,?)').run(key,userId,id,audio);return audio;}finally{speechPending.delete(key);}},
  evidenceStatus:()=>options.evidenceStatus?.()??{status:'not_ready',actions:['导出独立人工审核任务并导入真实结果。']},
  memoryFor,async wait(id:string){await pending.get(id);},
  close(){if(closed)return;if(pending.size||speechPending.size)fail('DEPENDENCY_UNAVAILABLE');db.close();closed=true;},
 };
}
export type PilotService=ReturnType<typeof createPilotService>;
