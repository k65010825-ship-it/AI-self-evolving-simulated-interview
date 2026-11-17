import {randomUUID} from 'node:crypto';import type {Database} from 'bun:sqlite';
import {openLocalProfile,LocalError,type LocalProfile} from './profile-store.ts';
import {LocalCommandSchemas,LocalReadPageSchema,LocalJobViewSchema,LocalSessionViewSchema,LocalEventSchema,type LocalCommand,type LocalEvent} from '../../../../packages/contracts/src/local-runtime.ts';
import {RoleIdSchema,type RoleId} from '../../../../packages/contracts/src/tools.ts';
import {AgentRunRequestSchema,AgentRunSnapshotSchema,type AgentRunRequest,type AgentRunSnapshot} from '../../../../packages/contracts/src/agent-run.ts';
import {WorkflowSchema,type InterviewWorkflow} from '../../../../packages/contracts/src/session-workflow.ts';
import {MemorySnapshotSchema} from '../../../../packages/contracts/src/memory.ts';import {createMemory} from '../memory/session-memory.ts';
import {createWorkflowCommitTicket,prepareWorkflowCommit,workflowCommitDigest as digest} from '../../../../packages/agent-client/src/workflow-commit.ts';
import {createOfflineRunManager} from '../runtime/offline-runtime.ts';
import {localReport,localSessionPresentation,localAnswerPage} from './presentation.ts';
import {createLiveRunManager} from '../runtime/live-runtime.ts';
import {createLocalSpeechHost,validateLocalSpeechSource,type SpeechSource} from './speech-host.ts';
import {LocalSpeechCommandSchemas,type LocalSpeechCommand} from '../../../../packages/contracts/src/local-speech-api.ts';
import type {LocalSpeechDependencies} from './speech-executor.ts';
import {createRunManager} from '../runtime/run-manager.ts';
import {seedHistoryCompatibility} from '../tools/knowledge-executor.ts';
import {createLocalLiveStore} from './live-store.ts';
import {LocalLiveGrantInputSchema,type LocalLiveGrant} from '../../../../packages/contracts/src/local-live.ts';
import type {LocalCredentialBinding} from '../../../../packages/contracts/src/local-credential.ts';
import type {LiveFetch} from '../model-access/bailian-provider.ts';
import {EvaluationDiagnosticSchema,type EvaluationDiagnostic} from '../../../../packages/contracts/src/evaluation-diagnostic.ts';
import {createLocalHintHost} from './hint-host.ts';
import type {HintRepository} from '../hints/repository-port.ts';
type Job={job_id:string;operation_id:string;session_id:string;role_id:RoleId;digest:string;request:string;ticket:string;status:string;snapshot:string|null;receipt:string|null;error_code:string|null;created_at:number};
type Session={session_id:string;role_id:RoleId;storage_version:number;workflow:string|null;created_at:number;deadline_at:number};
const labels:Record<RoleId,Record<string,string>>={'java-backend':{'spring-transactions':'Spring事务','java-concurrency':'Java并发','project-design':'项目设计','collaboration':'协作表达'},'web-frontend':{'async-state':'React异步状态','javascript':'JavaScript基础','project-design':'项目设计','collaboration':'协作表达'}};
function fail(code:string):never{throw new LocalError(code);}
function safeCode(error:unknown){const c=(error as {code?:unknown}|null)?.code;return typeof c==='string'&&/^[A-Z_]{1,80}$/.test(c)?c:'DEPENDENCY_UNAVAILABLE';}
type LocalHostOptions={hints?:HintRepository;dataDir:string;assetsRoot:string;now?:()=>number;leaseMs?:number;resolveCredential?:(binding:LocalCredentialBinding,options:{signal:AbortSignal})=>Promise<string>;liveFetch?:LiveFetch;speechFetch?:LocalSpeechDependencies['fetch'];onSpeechGrant?:(binding:LocalCredentialBinding,previous?:string)=>void;onGrant?:(grant:LocalLiveGrant,previousGrantId?:string)=>void;onRevoke?:(grantId:string)=>void};
export async function createLocalHost(options:LocalHostOptions){
 const profile=openLocalProfile(options),cleanup=[()=>profile.close()];
 try{return initializeLocalHost(profile,options,cleanup);}
 catch(error){for(const dispose of cleanup.reverse())try{dispose();}catch{/* Preserve the original initialization failure. */}throw error;}
}
/** Startup only recovers local records; provider dispatch starts after a command is accepted. */
function initializeLocalHost(profile:LocalProfile,options:LocalHostOptions,cleanup:(()=>void)[]){
 const clock=options.now??Date.now,live=createLocalLiveStore(profile,{now:clock});let closing=false,closed=false,executionStarts=0,modelHttpAttempts=0;
 const authorizedSessions=new Set<string>();
 const listeners=new Set<(event:LocalEvent)=>void>(),queue:string[]=[],pending=new Map<string,{done:Promise<void>;resolve:()=>void}>();
 const active=new Map<string,{manager?:ReturnType<typeof createRunManager>;cancelled:boolean;controller:AbortController}>();
 function row(db:Database,id:string){return(db.query('SELECT * FROM local_jobs WHERE job_id=?').get(id) as Job|null)??fail('NOT_FOUND');}
 function sessionRow(db:Database,id:string){return(db.query('SELECT * FROM local_sessions WHERE session_id=?').get(id)as Session|null)??fail('NOT_FOUND');}
 function memoryIn(db:Database,role:RoleId,at=clock()){const m=db.query('SELECT body FROM local_memory WHERE role_id=?').get(role) as {body:string}|null;return m?MemorySnapshotSchema.parse(JSON.parse(m.body)):createMemory({userId:profile.profileId,roleId:role},at);}
 const workflow=(s:Session)=>{if(!s.workflow)return null;const w=WorkflowSchema.parse(JSON.parse(s.workflow));if(w.state.sessionId!==s.session_id||w.identity.roleId!==s.role_id||w.identity.userId!==profile.profileId)fail('LOCAL_DATA_INVALID');return w;};
 function eventIn(db:Database,jobId:string,status:LocalEvent['status'],stage:string|null,diagnostic?:EvaluationDiagnostic){const seq=(db.query('SELECT COALESCE(MAX(seq),0) AS n FROM local_events WHERE job_id=?').get(jobId)as {n:number}).n+1;
  const event=LocalEventSchema.parse({jobId,seq,status,stage,...(diagnostic?{diagnostic}: {})});db.query('INSERT INTO local_events VALUES(?,?,?)').run(jobId,seq,JSON.stringify(event));return event;}
 function notify(event:LocalEvent){for(const fn of listeners)try{fn(structuredClone(event));}catch{/* views cannot change committed state */}}
 function job(id:string){return profile.read(db=>{const r=row(db,id);return LocalJobViewSchema.parse({jobId:r.job_id,operationId:r.operation_id,sessionId:r.session_id,status:r.status,errorCode:r.error_code});});}
 function terminate(id:string,status:'failed'|'cancelled'|'interrupted',code:string){let event:LocalEvent|undefined;
  profile.write(db=>{const j=row(db,id);if(!['queued','running'].includes(j.status))return;db.query('UPDATE local_jobs SET status=?,error_code=? WHERE job_id=?').run(status,code,id);event=eventIn(db,id,status,null);});if(event)notify(event);
 }
 const hints=createLocalHintHost({profile,...(options.hints?{repository:options.hints}:{}),now:clock,
  session:(db,id)=>{const s=sessionRow(db,id),w=workflow(s);if(!w)fail('VERSION_CONFLICT');return{workflow:w!,deadlineAt:s.deadline_at};},
  commitAssistance:(db,w,assistance)=>{const s=sessionRow(db,w.state.sessionId);
   const next=WorkflowSchema.parse({...w,revision:w.revision+1,hintAssistance:[...(w.hintAssistance??[]).filter(h=>h.questionId!==w.current!.question.id),{questionId:w.current!.question.id,assistance}]});
   const changed=db.query('UPDATE local_sessions SET workflow=?,storage_version=storage_version+1 WHERE session_id=? AND storage_version=?').run(JSON.stringify(next),s.session_id,s.storage_version);
   if(changed.changes!==1)fail('VERSION_CONFLICT');
  },
  assertAvailable:(db,id,operationId)=>{
   if(db.query('SELECT 1 FROM local_jobs WHERE operation_id=?').get(operationId)||db.query("SELECT 1 FROM local_speech_tasks WHERE json_extract(body,'$.operationId')=?").get(operationId))fail('HINT_OPERATION_CONFLICT');if(closing)fail('LOCAL_SHUTTING_DOWN');
   if(db.query("SELECT 1 FROM local_jobs WHERE session_id=? AND status IN ('queued','running')").get(id))fail('SESSION_BUSY');
   if(live.hasBlockedAccounting()||db.query("SELECT 1 FROM local_budget WHERE status IN ('unknown','dispatched')").get())fail('BUDGET_RECONCILIATION_REQUIRED');
  }});
 const speech=createLocalSpeechHost({profile,now:clock,session:id=>profile.read(db=>{const s=sessionRow(db,id),w=workflow(s);if(!w)fail('VERSION_CONFLICT');return{workflow:w,deadlineAt:s.deadline_at,mode:live.budget(id)?'live':'offline-fixture'};}),submitAnswer:(input,source)=>command('session.answer',input,source),notify,interviewActive:()=>active.size,onIdle:drain,cancelAnswer:id=>{const a=active.get(id);if(a){a.cancelled=true;a.controller.abort();a.manager?.dispose();}const ix=queue.indexOf(id);if(ix>=0)queue.splice(ix,1);terminate(id,'cancelled','RUN_CANCELLED');if(!a){pending.get(id)?.resolve();pending.delete(id);}},...(options.resolveCredential?{resolveCredential:options.resolveCredential}:{}),...(options.onSpeechGrant?{onGrant:options.onSpeechGrant}:{}),...(options.onRevoke?{onRevoke:options.onRevoke}:{}),...(options.speechFetch?{fetch:options.speechFetch}:{})});
 function commit(id:string,expectedGrantId?:string){let event:LocalEvent|undefined;
  profile.write(db=>{const j=row(db,id);if(j.status!=='running')return;
   const liveBudget=live.budget(j.session_id);if(liveBudget){const request=AgentRunRequestSchema.parse(JSON.parse(j.request));if(request.job.type==='workflow'&&['plan','answer'].includes(request.job.operation.action)){const grant=live.activeGrant(j.session_id),bindings=live.checkpoints().filter(c=>c.jobId===id);if(!grant||grant.expiresAt<=clock()||grant.grantId!==(expectedGrantId??bindings[0]?.grantId)||bindings.some(c=>c.grantId!==grant.grantId)||live.hasBlockedAccounting())fail('LOCAL_GRANT_INACTIVE');}}
   const request=AgentRunRequestSchema.parse(JSON.parse(j.request)),run=AgentRunSnapshotSchema.parse(JSON.parse(j.snapshot??'null')),s=sessionRow(db,j.session_id),w=workflow(s);
   validateLocalSpeechSource(profile,id);
   const decision=prepareWorkflowCommit({ticket:JSON.parse(j.ticket),request,run,current:{session:w?{storageVersion:s.storage_version,workflow:w}:null,memory:memoryIn(db,j.role_id)},receipt:j.receipt?JSON.parse(j.receipt):null,now:clock()});
   if(decision.kind!=='uncommitted-workflow-commit-plan')fail('VERSION_CONFLICT');
   const changed=db.query('UPDATE local_sessions SET workflow=?,storage_version=? WHERE session_id=? AND storage_version=?').run(JSON.stringify(decision.sessionWrite.workflow),decision.sessionWrite.storageVersion,s.session_id,s.storage_version);
   if(changed.changes!==1)fail('VERSION_CONFLICT');if(decision.memoryWrite)db.query('UPDATE local_memory SET body=? WHERE role_id=?').run(JSON.stringify(decision.memoryWrite),j.role_id);
   db.query("UPDATE local_jobs SET status='completed',receipt=?,error_code=NULL WHERE job_id=?").run(JSON.stringify(decision.receiptCandidate),id);event=eventIn(db,id,'completed',null);
  });if(event){notify(event);const s=sessionRowRead(id);if(s==='completed')speech.stopSession(profile.read(db=>row(db,id).session_id));}
 }
 function sessionRowRead(id:string){return profile.read(db=>workflow(sessionRow(db,row(db,id).session_id))?.phase);}
 // Recovery is observation/commit only: never recreate providers or repeat an interrupted call.
 const interrupted=profile.read(db=>db.query("SELECT * FROM local_jobs WHERE status IN ('queued','running') ORDER BY created_at").all()as Job[]);
 for(const j of interrupted){try{if(j.status==='running'&&j.snapshot&&JSON.parse(j.snapshot).status==='completed')commit(j.job_id);else terminate(j.job_id,'interrupted','INTERRUPTED');}catch(error){const code=safeCode(error);terminate(j.job_id,'interrupted',code==='DEPENDENCY_UNAVAILABLE'?'INTERRUPTED':code);}}
 function deferred(id:string){let p=pending.get(id);if(!p){let resolve!:()=>void;const done=new Promise<void>(r=>{resolve=r;});p={done,resolve};pending.set(id,p);}return p;}
 function checkpoint(id:string,snapshot:AgentRunSnapshot){let event!:LocalEvent;
  profile.write(db=>{const j=row(db,id);if(j.status!=='running')fail('RUN_CANCELLED');db.query('UPDATE local_jobs SET snapshot=? WHERE job_id=?').run(JSON.stringify(snapshot),id);
   event=eventIn(db,id,snapshot.status==='completed'?'candidate-ready':snapshot.status==='queued'?'queued':snapshot.status==='cancelled'?'cancelled':snapshot.status==='failed'?'failed':'running',snapshot.stage);
  });notify(event);
 }
 async function execute(id:string){executionStarts++;const state={cancelled:false,controller:new AbortController()}as {manager?:ReturnType<typeof createRunManager>;cancelled:boolean;controller:AbortController};active.set(id,state);let secret:string|undefined,grant:LocalLiveGrant|null=null;
  try{const request=profile.write(db=>{const j=row(db,id);if(j.status!=='queued')fail('RUN_CANCELLED');db.query("UPDATE local_jobs SET status='running' WHERE job_id=?").run(id);return AgentRunRequestSchema.parse(JSON.parse(j.request));});
   const metadata=profile.read(db=>row(db,id)),budget=live.budget(metadata.session_id),needsModel=request.job.type==='workflow'&&['plan','answer'].includes(request.job.operation.action);
   if(budget&&needsModel){grant=live.activeGrant(metadata.session_id);if(!grant||grant.expiresAt<=clock())fail('LOCAL_GRANT_INACTIVE');
    const binding={sessionId:metadata.session_id,jobId:id,grantId:grant.grantId};live.canDispatch(binding);
    if(!options.resolveCredential)fail('CREDENTIAL_UNAVAILABLE');options.onGrant?.(grant);secret=await options.resolveCredential(grant,{signal:state.controller.signal});
    if(state.cancelled||closing||state.controller.signal.aborted)fail('RUN_CANCELLED');live.canDispatch(binding);
    const config=budget.serviceConfig;if(!config)fail('LOCAL_CONFIG_INVALID');
    state.manager=createLiveRunManager({...config,authorization:{enabled:true,operatorApproved:true,expiresAt:grant.expiresAt,maxRuns:32}},{assetsRoot:profile.assetsRoot,readCredential:name=>name===config.profile.credentialSource.name?secret:undefined,
     fetch:async(input,init)=>{modelHttpAttempts++;return(options.liveFetch??globalThis.fetch)(input,init);},now:clock,
     canDispatchRun:()=>{try{return live.canDispatch(binding);}catch{return false;}},
     onEvaluationDiagnostic:(context,raw)=>{
      const diagnostic=EvaluationDiagnosticSchema.parse(raw);let event:LocalEvent|undefined;
      profile.write(db=>{const j=row(db,id);if(j.status!=='running'||state.cancelled||closing||context.runId!==id||j.session_id!==binding.sessionId)return;
       event=eventIn(db,id,'running',diagnostic.stage,diagnostic);
      });if(event)notify(event);
     },
     onRunCheckpoint:s=>checkpoint(id,s),onBudgetCheckpoint:(context,snapshot,p)=>{live.checkpoint({...binding,runId:context.runId,attemptId:context.attemptId,snapshot,profile:p});},
    });
   }else if(budget){state.manager=createRunManager({evaluateForRole:()=>{throw new LocalError('LOCAL_GRANT_INACTIVE');},now:clock,onCheckpoint:s=>checkpoint(id,s)});}
   else state.manager=await createOfflineRunManager({cwd:profile.assetsRoot,planning:'pi-knowledge',questionDelivery:'natural-bridge',onCheckpoint:s=>checkpoint(id,s)});
   if(state.cancelled||closing)fail('RUN_CANCELLED');state.manager.start(request);await state.manager.wait(id);
   const result=state.manager.snapshot(id);if(result.status!=='completed')fail(result.error?.code??'DEPENDENCY_UNAVAILABLE');if(grant&&(live.activeGrant(metadata.session_id)?.grantId!==grant.grantId||grant.expiresAt<=clock()))fail('LOCAL_GRANT_INACTIVE');commit(id,grant?.grantId);
  }catch(e){try{terminate(id,state.cancelled||closing?'cancelled':'failed',safeCode(e));}catch{/* lost profile ownership cannot write */}}
  finally{secret=undefined;state.controller.abort();state.manager?.dispose();active.delete(id);pending.get(id)?.resolve();pending.delete(id);drain();}
 }
 function drain(){if(closing)return;while(active.size+speech.activeCount<2&&queue.length){const id=queue.shift()!;void execute(id);}speech.drain();}
 function command(method:LocalCommand,raw:unknown,source?:SpeechSource){if(closing)fail('LOCAL_SHUTTING_DOWN');const parsed=LocalCommandSchemas[method].safeParse(raw);if(!parsed.success)fail('VALIDATION_ERROR');const c=parsed.data!,hash=digest({method,command:c,...(source?{speechSource:source}:{})});let event:LocalEvent|undefined,newJob=false;
  const result=profile.write(db=>{const hintOperation=hints.ownsOperation(db,c.operationId);if(hintOperation)fail('VERSION_CONFLICT');
   const prior=db.query('SELECT * FROM local_jobs WHERE operation_id=?').get(c.operationId)as Job|null;
   if(prior){if(prior.digest!==hash)fail('VERSION_CONFLICT');return{jobId:prior.job_id,sessionId:prior.session_id};}
   if(db.query("SELECT 1 FROM local_speech_tasks WHERE json_extract(body,'$.operationId')=?").get(c.operationId))fail('VERSION_CONFLICT');
   if((db.query("SELECT COUNT(*) AS n FROM local_jobs WHERE status IN ('queued','running')").get()as {n:number}).n>=8)fail('RATE_LIMITED');
   if(db.query("SELECT 1 FROM local_budget WHERE status IN ('unknown','dispatched') LIMIT 1").get())fail('BUDGET_RECONCILIATION_REQUIRED');
   const at=clock(),id=randomUUID(),sessionId=method==='session.create'?randomUUID():('sessionId'in c?c.sessionId:fail('VALIDATION_ERROR'));
   let s:Session,w:InterviewWorkflow|null;
   if(method==='session.create'){
    const create=LocalCommandSchemas['session.create'].parse(c);s={session_id:sessionId,role_id:create.roleId,storage_version:-1,workflow:null,created_at:at,deadline_at:at+create.durationMinutes*60000};w=null;
    if(db.query("SELECT 1 FROM local_sessions s WHERE role_id=? AND deadline_at>? AND ((workflow IS NOT NULL AND json_extract(workflow,'$.phase')!='completed') OR EXISTS(SELECT 1 FROM local_jobs j WHERE j.session_id=s.session_id AND j.status IN ('queued','running'))) LIMIT 1").get(create.roleId,at))fail('ROLE_SESSION_ACTIVE');
    db.query('INSERT INTO local_sessions VALUES(?,?,?,?,?,?)').run(s.session_id,s.role_id,-1,null,at,s.deadline_at);
    if(create.mode==='live')live.createSessionBudget({sessionId,profile:create.liveConfig!.profile,limits:create.sessionBudget,serviceConfig:create.liveConfig});
    if(create.speech)speech.store.configure({sessionId,policy:create.speech,modelLimits:{maxCostMicros:create.sessionBudget?.maxCostMicros??0}});
   }else{s=sessionRow(db,sessionId);w=workflow(s);if(!w||!('expectedRevision'in c)||w.revision!==c.expectedRevision)fail('VERSION_CONFLICT');}
   const liveBudget=live.budget(sessionId);
   if(liveBudget&&['session.nextQuestion','session.answer'].includes(method)){if(live.hasBlockedAccounting())fail('BUDGET_RECONCILIATION_REQUIRED');const g=live.activeGrant(sessionId);if(!authorizedSessions.has(sessionId)||!g||g.expiresAt<=at)fail('LOCAL_GRANT_INACTIVE');}
   if(db.query("SELECT 1 FROM local_jobs WHERE session_id=? AND status IN ('queued','running') AND json_extract(request,'$.kind') IS NOT 'local-speech-task'").get(sessionId))fail('SESSION_BUSY');
   const memory=memoryIn(db,s.role_id,at);db.query('INSERT INTO local_memory VALUES(?,?) ON CONFLICT DO NOTHING').run(s.role_id,JSON.stringify(memory));
   const context={userId:profile.profileId,roleId:s.role_id,runId:id,attemptId:'attempt-1',deadlineAt:Math.min(s.deadline_at,at+30000)},identity={userId:profile.profileId,roleId:s.role_id};
   let operation:unknown;
   if(method==='session.create'){const create=LocalCommandSchemas['session.create'].parse(c);operation={action:'create',config:{identity,session:{sessionId,roleId:s.role_id,durationMinutes:create.durationMinutes,historyCompatibility:seedHistoryCompatibility(s.role_id,Object.keys(labels[s.role_id])),skills:Object.keys(labels[s.role_id]).map((skillId,i)=>({skillId,relevance:1-i*.05}))},policy:{id:'local-v2-'+s.role_id,roleId:s.role_id,parameters:{maxFollowupDepth:create.pressure?2:1,maxTurns:6,wrapUpSeconds:45,difficultyProgression:'independent-evidence-v1'}},goal:create.goal,skillLabels:labels[s.role_id],memory,allowDraftKnowledge:true,now:at}};}
   else if(method==='session.nextQuestion')operation={action:'plan',snapshot:w,command:{identity,expectedRevision:w!.revision,context}};
   else if(method==='session.answer'){
    const answer=LocalCommandSchemas['session.answer'].parse(c),assistance=hints.assistanceIn(db,w!);
    // The current question's committed receipt owns observation identity across clarification.
    // Each submission still gets its own answer/run identity, task and idempotency receipt.
    const previous=w!.clarificationAttempts?.filter(a=>a.input.question.id===w!.current?.question.id).at(-1)?.resolution;
    const observationId=previous?.status==='needs_clarification'?previous.observationId:randomUUID();
    operation={action:'answer',snapshot:w,command:{identity,expectedRevision:w!.revision,context,observationId,answer:source?source.speech.answer:{id:randomUUID(),text:answer.text},...(source?{speech:source.speech}:{}),...(assistance?{assistance}:{}),quality:1,evidenceMode:liveBudget?'live-model':'offline-fixture'}};}
   else operation={action:'finish',snapshot:w,command:{identity,expectedRevision:w!.revision,mode:'user_stop',sourceGroupId:'local-'+sessionId}};
   const request=AgentRunRequestSchema.parse({inputSnapshotId:'input-'+id,context,job:{type:'workflow',operation}}),ticket=createWorkflowCommitTicket({identity,request,operationId:c.operationId,taskId:id,leaseVersion:profile.fence,expectedStorageVersion:w?s.storage_version:null,expectedMemoryVersion:memory.version,issuedAt:at,leaseUntil:context.deadlineAt});
   db.query('INSERT INTO local_jobs VALUES(?,?,?,?,?,?,?,?,NULL,NULL,NULL,?)').run(id,c.operationId,sessionId,s.role_id,hash,JSON.stringify(request),JSON.stringify(ticket),'queued',at);
   if(source)db.query('INSERT INTO local_speech_links VALUES(?,?,?,?)').run(id,source.taskId,source.confirmationId,source.digest);
   event=eventIn(db,id,'queued',null);newJob=true;return{jobId:id,sessionId};
  });if(event)queueMicrotask(()=>{try{job(event!.jobId);notify(event!);}catch{}});if(newJob){deferred(result.jobId);queueMicrotask(()=>{try{if(job(result.jobId).status!=='queued')return;queue.push(result.jobId);drain();}catch{pending.get(result.jobId)?.resolve();pending.delete(result.jobId);}});}return result;
 }
 function session(id:string,summary=false){return profile.read(db=>{const s=sessionRow(db,id),w=workflow(s),last=db.query('SELECT job_id FROM local_jobs WHERE session_id=? ORDER BY rowid DESC LIMIT 1').get(id)as {job_id:string}|null,lastOperation=last?job(last.job_id):null;return LocalSessionViewSchema.parse({...localSessionPresentation(w,summary),viewKind:summary?'summary':'full',startedAt:w?.state.startedAt??s.created_at,hasReport:!!w?.closeout,sessionId:id,roleId:s.role_id,revision:w?.revision??-1,phase:w?.phase??(lastOperation&&!['queued','running'].includes(lastOperation.status)?lastOperation.status:'creating'),deadlineAt:s.deadline_at,
  question:!summary&&w?.current?{id:w.current.question.id,text:w.issuedQuestions.at(-1)?.content?.text??w.current.question.text}:null,answeredCount:w?.turns.length??0,priorEvidenceCount:w?.state.priorEvidence.length??0,
  report:!summary&&w?localReport(w):null,lastOperation,mode:live.budget(id)?'live':'offline-fixture',authorizationStatus:live.budget(id)?(authorizedSessions.has(id)&&(live.activeGrant(id)?.expiresAt??0)>clock()?'authorized':'required'):'not-required'});});}
 const heartbeat=setInterval(()=>{try{profile.renew();}catch{closing=true;for(const a of active.values()){a.cancelled=true;a.controller.abort();a.manager?.dispose();}}},Math.max(1,Math.floor(profile.leaseMs/3)));cleanup.push(()=>clearInterval(heartbeat));heartbeat.unref();
 return{hint:hints.request,hintStatus:hints.status,hintsAvailable:hints.available,command:(method:LocalCommand,raw:unknown)=>command(method,raw),session,
  answerPage:(raw:unknown)=>{const p=LocalReadPageSchema.safeParse(raw);if(!p.success)fail('VALIDATION_ERROR');return profile.read(db=>localAnswerPage(workflow(sessionRow(db,p.data.sessionId)),{offset:p.data.offset,limit:p.data.limit,...(p.data.expectedRevision!==undefined?{expectedRevision:p.data.expectedRevision}:{})},p.data.sessionId));},
  report:(raw:unknown)=>{const p=LocalReadPageSchema.safeParse(raw);if(!p.success)fail('VALIDATION_ERROR');return profile.read(db=>localReport(workflow(sessionRow(db,p.data.sessionId)),{offset:p.data.offset,limit:p.data.limit,...(p.data.expectedRevision!==undefined?{expectedRevision:p.data.expectedRevision}:{})}));},
  job,speech:(method:LocalSpeechCommand,raw:unknown)=>{const p=LocalSpeechCommandSchemas[method]?.safeParse(raw);if(!p?.success)fail('VALIDATION_ERROR');
   const operationId='operationId'in p!.data?p!.data.operationId:null;
   if(typeof operationId==='string')profile.read(db=>{if(hints.ownsOperation(db,operationId))fail('VERSION_CONFLICT');});
   return speech.command(method,p!.data);},
  authorize(raw:unknown){const i=LocalLiveGrantInputSchema.parse(raw),s=session(i.sessionId);if(s.phase==='completed'||i.expiresAt>s.deadlineAt||clock()>=s.deadlineAt)fail('LOCAL_GRANT_INACTIVE');const prior=live.activeGrant(i.sessionId),g=live.authorize(i);options.onGrant?.(g,prior?.grantId);authorizedSessions.add(i.sessionId);return g;},
  revoke(raw:{sessionId:string;expectedVersion:number}){const prior=live.activeGrant(raw.sessionId),result=live.revoke(raw);authorizedSessions.delete(raw.sessionId);if(prior)options.onRevoke?.(prior.grantId);for(const [id,a]of active)if(profile.read(db=>row(db,id).session_id)===raw.sessionId){a.cancelled=true;a.controller.abort();a.manager?.dispose();}return result;},
  liveTotals:(sessionId:string)=>live.totals(sessionId),liveBudget:(sessionId:string)=>({budget:live.budget(sessionId),totals:live.totals(sessionId),grant:live.activeGrant(sessionId),version:profile.read(db=>(db.query('SELECT grant_version FROM local_session_budgets WHERE session_id=?').get(sessionId)as {grant_version:number}|null)?.grant_version??0)}),reconcile:live.reconcile,
  list:(offset=0,limit=100)=>{if(!Number.isSafeInteger(offset)||offset<0||offset>1000000||!Number.isInteger(limit)||limit<1||limit>100)fail('VALIDATION_ERROR');return profile.read(db=>(db.query('SELECT session_id FROM local_sessions ORDER BY created_at DESC,session_id DESC LIMIT ? OFFSET ?').all(limit,offset)as {session_id:string}[]).map(s=>session(s.session_id,true)));},
  listJobs:()=>profile.read(db=>(db.query('SELECT job_id FROM local_jobs ORDER BY created_at DESC,job_id DESC LIMIT 100').all()as {job_id:string}[]).map(j=>job(j.job_id))),
  memory:(role:RoleId)=>{RoleIdSchema.parse(role);return profile.read(db=>memoryIn(db,role));},
  events:(id:string,afterSeq=0)=>profile.read(db=>{row(db,id);if(!Number.isSafeInteger(afterSeq)||afterSeq<0)fail('VALIDATION_ERROR');const max=(db.query('SELECT COALESCE(MAX(seq),0) AS n FROM local_events WHERE job_id=?').get(id)as {n:number}).n;if(afterSeq>max)fail('VERSION_CONFLICT');return(db.query('SELECT event FROM local_events WHERE job_id=? AND seq>? ORDER BY seq LIMIT 100').all(id,afterSeq)as {event:string}[]).map(e=>LocalEventSchema.parse(JSON.parse(e.event)));}),
  wait:async(id:string)=>{job(id);if(speech.owns(id))await speech.wait(id);else await pending.get(id)?.done;},
  cancel(id:string){const j=job(id);if(speech.owns(id)){speech.cancel(id);return job(id);}if(!['queued','running'].includes(j.status))return j;const a=active.get(id);if(a){a.cancelled=true;a.controller.abort();a.manager?.dispose();}else{const index=queue.indexOf(id);if(index>=0)queue.splice(index,1);pending.get(id)?.resolve();pending.delete(id);}terminate(id,'cancelled','RUN_CANCELLED');return job(id);},
  subscribe(fn:(event:LocalEvent)=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  status:()=>profile.read(db=>({mode:'local-runtime' as const,storage:'local-sqlite',liveModelCalls:options.liveFetch?0:modelHttpAttempts,modelHttpAttempts,executionStarts,activeJobs:active.size+speech.stats().activeJobs,queuedJobs:queue.length+speech.stats().queuedJobs,speechHttpAttempts:speech.stats().speechHttpAttempts,liveSpeechCalls:speech.stats().liveSpeechCalls,unknownAttempts:speech.stats().unknownAttempts+(db.query("SELECT COUNT(*) AS n FROM local_budget WHERE status='unknown'").get()as {n:number}).n+live.checkpoints().reduce((n,c)=>n+c.snapshot.entries.filter(e=>e.status==='unknown').length,0)})),
  async close(){if(closed)return;closing=true;clearInterval(heartbeat);const voiceClose=speech.close();void voiceClose.catch(()=>{});for(const id of queue.splice(0)){try{terminate(id,'cancelled','RUN_CANCELLED');}catch{/* fenced writers only release owned resources */}pending.get(id)?.resolve();pending.delete(id);}for(const a of active.values()){a.cancelled=true;a.controller.abort();a.manager?.dispose();}
   let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([Promise.all([voiceClose,...[...pending.values()].map(p=>p.done)]),new Promise<never>((_r,reject)=>{timer=setTimeout(()=>reject(new LocalError('LOCAL_SHUTDOWN_INCOMPLETE')),1500);})]);}finally{clearTimeout(timer);listeners.clear();profile.close();closed=true;}
  },
 };
}
