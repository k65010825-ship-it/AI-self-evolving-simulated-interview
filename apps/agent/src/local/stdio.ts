import {LOCAL_PRESENTATION_CAPABILITY,LOCAL_PROGRESS_VIEWS_CAPABILITY} from '../../../../packages/contracts/src/local-presentation.ts';
import {LOCAL_LEARNING_CAPABILITY} from '../../../../packages/contracts/src/local-learning.ts';
import {LOCAL_EXPERIMENTS_CAPABILITY} from '../../../../packages/contracts/src/local-experiment.ts';
import {AgentStateError} from '../planning/interview-state.ts';
import {z} from 'zod';import {LocalRequestSchema,LocalCommandSchemas,LocalNotificationSchema,type LocalCommand} from '../../../../packages/contracts/src/local-runtime.ts';
import {RoleIdSchema} from '../../../../packages/contracts/src/tools.ts';import {createLocalHost} from './host.ts';import {LocalError} from './profile-store.ts';
import {write as writeFd} from 'node:fs';
import {createRuntimeCredentialBroker} from './credential-broker.ts';
import {LOCAL_CREDENTIAL_CAPABILITY,LocalCredentialError} from '../../../../packages/contracts/src/local-credential.ts';
import {LocalLiveReconciliationSchema} from '../../../../packages/contracts/src/local-live.ts';
import {LocalSpeechCommandSchemas,type LocalSpeechCommand} from '../../../../packages/contracts/src/local-speech-api.ts';
import {HintError} from '../hints/limited-hints.ts';
import {createRuntimeDiagnostics} from './process-diagnostics.ts';
import {buildRoleCatalogList} from '../knowledge/catalog.ts';
const MAX=1024*1024;
export async function serveLocalStdio(options:Parameters<typeof createLocalHost>[0]){
 const diagnose=createRuntimeDiagnostics(line=>process.stderr.write(line));let lastMethod='';
 let credentialEnabled=false,initialized=false,shutting=false,failed=false,queued=0;let writes=Promise.resolve();
 const broker=createRuntimeCredentialBroker({send:frame=>send(frame)});
 const host=await createLocalHost({...options,onSpeechGrant:(binding,previous)=>{if(previous&&previous!==binding.grantId)broker.revoke(previous);broker.setGrant(binding);},resolveCredential:(binding,context)=>broker.request(binding,context),onGrant:(grant,previous)=>{if(previous&&previous!==grant.grantId)broker.revoke(previous);broker.setGrant({grantId:grant.grantId,credentialRef:grant.credentialRef,expiresAt:grant.expiresAt});},onRevoke:id=>broker.revoke(id)});
 diagnose({stage:'startup',code:'HOST_READY'});let fatalExit=false;
 function outputFailure(){diagnose({stage:'output',code:'OUTPUT_FAILED'});failed=true;process.stdin.destroy();if(!fatalExit){fatalExit=true;void stop().then(()=>process.exit(1),()=>process.exit(1));}}
 process.stdout.on('error',outputFailure);
 function send(value:unknown){if(failed)throw new LocalError('LOCAL_PIPE_CLOSED');const text=JSON.stringify(value)+'\n',size=Buffer.byteLength(text);if(size>MAX)throw new LocalError('LOCAL_RESPONSE_LIMIT');if(queued+size>2*MAX)throw new LocalError('LOCAL_BACKPRESSURE');queued+=size;
  const task=writes.then(()=>new Promise<void>((resolve,reject)=>{if(failed){reject(new LocalError('LOCAL_PIPE_CLOSED'));return;}const timer=setTimeout(()=>{diagnose({stage:'output',code:'OUTPUT_TIMEOUT'});outputFailure();reject(new LocalError('LOCAL_BACKPRESSURE'));},2000);
   const bytes=Buffer.from(text);let offset=0;
   const next=()=>writeFd(1,bytes,offset,bytes.length-offset,null,(error,count)=>{if(error||count<=0){clearTimeout(timer);reject(new LocalError('LOCAL_PIPE_CLOSED'));return;}offset+=count;if(offset<bytes.length)next();else{clearTimeout(timer);resolve();}});next();
  })).finally(()=>{queued-=size;});writes=task.catch(()=>{});return task;}
 function enqueue(value:unknown){void send(value).catch(outputFailure);}
 let stopWork:Promise<void>|undefined;
 function stop(){return stopWork??=(async()=>{diagnose({stage:'shutdown',code:'SHUTDOWN_STARTED'});shutting=true;process.stdin.pause();broker.close();try{await host.close();diagnose({stage:'shutdown',code:'SHUTDOWN_COMPLETED'});}catch(e){diagnose({stage:'shutdown',code:'SHUTDOWN_FAILED'});throw e;}})();}
 const unsubscribe=host.subscribe(event=>{try{void send(LocalNotificationSchema.parse({protocolVersion:1,type:'event',event})).catch(()=>{failed=true;process.stdin.destroy();});}catch{failed=true;process.stdin.destroy();}});
 const empty=z.object({}).strict(),id=z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/);
 async function dispatch(method:string,raw:unknown){if(method!==lastMethod){lastMethod=method;diagnose({stage:'rpc',code:'REQUEST_RECEIVED',method});}if(!initialized&&method!=='runtime.initialize'&&method!=='runtime.shutdown')throw new LocalError('LOCAL_NOT_INITIALIZED');
  if(method==='runtime.initialize'){const p=z.object({capabilities:z.array(z.literal(LOCAL_CREDENTIAL_CAPABILITY)).max(1).default([])}).strict().parse(raw);credentialEnabled=p.capabilities.includes(LOCAL_CREDENTIAL_CAPABILITY);broker.setNegotiated(credentialEnabled);initialized=true;return{protocolVersion:1,mode:'local-runtime',storage:'local-sqlite',capabilities:['text-interview','persistent-memory','persistent-jobs','event-replay','local-speech-v1',LOCAL_PRESENTATION_CAPABILITY,LOCAL_PROGRESS_VIEWS_CAPABILITY,LOCAL_CREDENTIAL_CAPABILITY,...(host.hintsAvailable?['limited-hints-v1']:[]),...(host.learningAvailable?[LOCAL_LEARNING_CAPABILITY]:[]),...(host.experimentsAvailable?[LOCAL_EXPERIMENTS_CAPABILITY]:[])],liveModelCalls:0};}
  if(method==='runtime.shutdown'){empty.parse(raw);await stop();return{stopped:true};}
  if(method==='hint.status')return host.hintStatus(raw);
  if(method==='hint.request')return host.hint(raw);
  if(method==='runtime.status'){empty.parse(raw);return host.status();}
  if(method==='live.authorize'){if(!credentialEnabled)throw new LocalError('CREDENTIAL_NOT_NEGOTIATED');return host.authorize(raw);}
  if(method==='live.revoke')return host.revoke(z.object({sessionId:id,expectedVersion:z.number().int().nonnegative()}).strict().parse(raw));
  if(method==='live.budget')return host.liveBudget(z.object({sessionId:id}).strict().parse(raw).sessionId);
  if(method==='live.reconcile')return host.reconcile(LocalLiveReconciliationSchema.parse(raw));
  if(Object.hasOwn(LocalSpeechCommandSchemas,method)){if(method==='speech.authorize'&&!credentialEnabled)throw new LocalError('CREDENTIAL_NOT_NEGOTIATED');return host.speech(method as LocalSpeechCommand,raw);}
  if(Object.hasOwn(LocalCommandSchemas,method))return host.command(method as LocalCommand,raw);
  if(method==='roles.list'){empty.parse(raw);return buildRoleCatalogList();}
  if(method==='session.list'){const p=z.object({offset:z.number().int().min(0).max(1000000).default(0),limit:z.number().int().min(1).max(100).default(100)}).strict().parse(raw);return host.list(p.offset,p.limit);}
  if(method==='session.get')return host.session(z.object({sessionId:id}).strict().parse(raw).sessionId);
  if(method==='session.answers')return host.answerPage(raw);
  if(method==='session.report')return host.report(raw);
  if(method==='memory.get')return host.memory(z.object({roleId:RoleIdSchema}).strict().parse(raw).roleId);
  if(method==='profile.get')return host.profileView(raw);
  if(method==='practice.recommendations')return host.practiceRecommendations(raw);
  if(method==='reflection.list')return host.reflections(raw);
  if(method==='learning.status')return host.learningStatus(raw);
  if(method==='learning.assignment.create')return host.createLearningAssignment(raw);
  if(method==='learning.event.record')return host.recordLearningEvent(raw);
  if(method==='learning.retest.plan')return host.planLearningRetest(raw);
  if(method==='learning.retest.pair')return host.pairLearningRetest(raw);
  if(method==='experiment.status')return host.experimentStatus(raw);
  if(method==='experiment.evaluate')return host.evaluateExperiment(raw);
  if(method==='experiment.rollback')return host.rollbackExperiment(raw);
  if(method==='job.get'||method==='job.cancel'){const p=z.object({jobId:id}).strict().parse(raw);return method==='job.get'?host.job(p.jobId):host.cancel(p.jobId);}
  if(method==='job.events'){const p=z.object({jobId:id,afterSeq:z.number().int().nonnegative().default(0)}).strict().parse(raw);return host.events(p.jobId,p.afterSeq);}
  throw new LocalError('NOT_IMPLEMENTED');
 }
 async function line(text:string){let value:unknown;try{value=JSON.parse(text);}catch{throw new LocalError('LOCAL_PROTOCOL_INVALID');}
  // Private replies are consumed even when stale; never enter public RPC parsing.
  if(value&&typeof value==='object'&&'type'in value&&value.type==='credential-response'){broker.receive(value);return;}
  const p=LocalRequestSchema.safeParse(value);
  if(!p.success){const envelope=z.object({protocolVersion:z.literal(1),type:z.literal('request'),id,method:z.string().min(1).max(80),params:z.unknown()}).strict().safeParse(value);
   if(!envelope.success)throw new LocalError('LOCAL_PROTOCOL_INVALID');enqueue({protocolVersion:1,type:'response',id:envelope.data.id,ok:false,error:{code:'NOT_IMPLEMENTED'}});return;
  }const request=p.data;
  const base={protocolVersion:1,type:'response',id:request.id};
  try{const result=await dispatch(request.method,request.params);enqueue({...base,ok:true,result});}
  catch(e){const code=e instanceof LocalError||e instanceof LocalCredentialError||e instanceof HintError||e instanceof AgentStateError?e.code:e instanceof z.ZodError?'VALIDATION_ERROR':'DEPENDENCY_UNAVAILABLE';enqueue({...base,ok:false,error:{code}});}
 }
 const signal=()=>{void stop().then(()=>{process.stdin.destroy();},()=>{failed=true;process.stdin.destroy();});};
 process.once('SIGTERM',signal);process.once('SIGINT',signal);
 try{const decoder=new TextDecoder('utf-8',{fatal:true});let pending='';
  for await(const chunk of process.stdin){pending+=decoder.decode(chunk as Uint8Array,{stream:true});let at:number;
   while((at=pending.indexOf('\n'))>=0){const frame=pending.slice(0,at).replace(/\r$/,'');pending=pending.slice(at+1);if(Buffer.byteLength(frame)>MAX)throw new LocalError('LOCAL_FRAME_LIMIT');if(shutting)break;await line(frame);}
   if(Buffer.byteLength(pending)>MAX)throw new LocalError('LOCAL_FRAME_LIMIT');if(shutting)break;
  }
  pending+=decoder.decode();if(pending.trim()&&!shutting)throw new LocalError('LOCAL_PROTOCOL_INVALID');diagnose({stage:'input',code:'INPUT_CLOSED'});
 }catch{diagnose({stage:'input',code:'INPUT_INVALID'});failed=true;}finally{process.removeListener('SIGTERM',signal);process.removeListener('SIGINT',signal);unsubscribe();try{await stop();await writes;}catch{failed=true;}}
 if(failed){process.stdout.destroy();process.exitCode=1;}
}
