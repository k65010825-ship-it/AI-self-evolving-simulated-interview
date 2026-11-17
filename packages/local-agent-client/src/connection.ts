import type {z} from 'zod';
import {LocalAnswerPageSchema,LocalReportViewSchema,type LocalReadPageOptions} from '../../contracts/src/local-presentation.ts';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {LocalRequestSchema,LocalResponseSchema,LocalNotificationSchema,LocalSessionViewSchema,type LocalRequest,type LocalEvent} from '../../contracts/src/local-runtime.ts';
import {createMainCredentialBroker,type LocalCredentialResolver} from './credential-broker.ts';
import {LOCAL_CREDENTIAL_CAPABILITY} from '../../contracts/src/local-credential.ts';
import {LocalSpeechGrantSchema} from '../../contracts/src/local-speech.ts';
import {LocalLiveGrantSchema} from '../../contracts/src/local-live.ts';
import {createProcessDiagnostics} from './process-diagnostics.ts';
import type {LocalProcessDiagnostic,LocalProcessFailureContext} from '../../contracts/src/local-process.ts';
export class LocalAgentClientError extends Error{constructor(readonly code:string,readonly diagnostic?:LocalProcessFailureContext){super(code);}}
export function bindLocalProcess(child:ChildProcessWithoutNullStreams,options:{timeoutMs?:number;resolveCredential?:LocalCredentialResolver;onDiagnostic?:(event:LocalProcessDiagnostic)=>void}){
 let closed=false,exiting=false,closing=false,faulted=false,stdoutEnded=false,pendingText='';const decoder=new TextDecoder('utf-8',{fatal:true});
 const diagnostics=createProcessDiagnostics(options.onDiagnostic);diagnostics.record({source:'client',stage:'process',code:'PROCESS_SPAWNED'});
 const ownerToken={},sessionGrants=new Map<string,string>();
 const broker=createMainCredentialBroker({ownerToken,resolveCredential:options.resolveCredential??(async()=>undefined),send:frame=>new Promise<void>((resolve,reject)=>{if(closed||faulted){reject(new LocalAgentClientError('LOCAL_PIPE_CLOSED'));return;}child.stdin.write(JSON.stringify(frame)+'\n',error=>error?reject(new LocalAgentClientError('LOCAL_PIPE_CLOSED')):resolve());})});
 const pending=new Map<string,{method:LocalRequest['method'];resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>(),listeners=new Set<(event:LocalEvent)=>void>();
 let resolveExit!:(code:number|null)=>void;const exited=new Promise<number|null>(resolve=>{resolveExit=resolve;});
 function fail(code:string){broker.close();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new LocalAgentClientError(code,diagnostics.context()));}pending.clear();}
 function terminal(code:string){faulted=true;fail(code);}
 function protocolFailure(){if(faulted)return;diagnostics.record({source:'client',stage:'input',code:'PROTOCOL_INVALID'});terminal('LOCAL_PROTOCOL_INVALID');child.kill('SIGKILL');}
 function finishStdout(){if(stdoutEnded)return;stdoutEnded=true;try{pendingText+=decoder.decode();if(pendingText.length)protocolFailure();}catch{protocolFailure();}}
 child.stderr.on('data',diagnostics.stderr);
 child.stderr.on('error',()=>{diagnostics.record({source:'client',stage:'process',code:'PIPE_ERROR'});});
 child.stdout.on('error',()=>{diagnostics.record({source:'client',stage:'input',code:'PIPE_ERROR'});terminal('LOCAL_PIPE_CLOSED');child.kill('SIGKILL');});
 child.stdin.on('error',()=>{diagnostics.record({source:'client',stage:'output',code:'PIPE_ERROR'});terminal('LOCAL_PIPE_CLOSED');});
 child.once('error',()=>{diagnostics.record({source:'client',stage:'process',code:'PROCESS_ERROR'});closed=true;terminal('LOCAL_PROCESS_FAILED');resolveExit(null);});
 child.once('exit',(code,signal)=>{exiting=true;diagnostics.record({source:'client',stage:'process',code:'PROCESS_EXIT',exitCode:code,signal:['SIGTERM','SIGKILL','SIGINT','SIGABRT','SIGSEGV'].includes(signal??'')?signal as 'SIGKILL':null});});
 // exit does not guarantee that stdio has drained. Only close settles remaining requests.
 child.once('close',code=>{finishStdout();closed=true;diagnostics.record({source:'client',stage:'process',code:'PROCESS_CLOSED',exitCode:code});if(!faulted)fail('LOCAL_PROCESS_EXITED');resolveExit(code);});
 child.stdout.once('end',finishStdout);
 child.stdout.on('data',(chunk:Buffer)=>{if(faulted||closed)return;try{if(stdoutEnded)throw Error();pendingText+=decoder.decode(chunk,{stream:true});let at:number;
  while((at=pendingText.indexOf('\n'))>=0){const text=pendingText.slice(0,at);pendingText=pendingText.slice(at+1);if(Buffer.byteLength(text)>1024*1024)throw Error();const raw=JSON.parse(text);
   if(raw&&typeof raw==='object'&&['credential-request','credential-cancel'].includes(raw.type)){void broker.handle(raw,ownerToken);continue;}
   const notification=LocalNotificationSchema.safeParse(raw);
   if(notification.success){for(const fn of listeners)try{fn(notification.data.event);}catch{}continue;}
   const response=LocalResponseSchema.parse(raw),p=pending.get(response.id);if(!p)throw Error();diagnostics.record({source:'client',stage:'rpc',code:'RESPONSE_RECEIVED',method:p.method});pending.delete(response.id);clearTimeout(p.timer);if(response.ok)p.resolve(response.result);else p.reject(new LocalAgentClientError(response.error.code));
  }if(Buffer.byteLength(pendingText)>1024*1024)throw Error();
 }catch{protocolFailure();}});
 function rawRequest(method:LocalRequest['method'],params:unknown,internal=false):Promise<unknown>{
  if(closed||exiting||faulted||closing&&!internal)return Promise.reject(new LocalAgentClientError('LOCAL_PROCESS_CLOSED'));if(pending.size>=8)return Promise.reject(new LocalAgentClientError('RATE_LIMITED'));
  const message=LocalRequestSchema.parse({protocolVersion:1,type:'request',id:randomUUID(),method,params}),text=JSON.stringify(message)+'\n';if(Buffer.byteLength(text)>1024*1024)return Promise.reject(new LocalAgentClientError('LOCAL_FRAME_LIMIT'));
  diagnostics.record({source:'client',stage:internal?'shutdown':'rpc',code:'REQUEST_SENT',method});
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{diagnostics.record({source:'client',stage:internal?'shutdown':'rpc',code:'REQUEST_TIMEOUT',method});terminal('LOCAL_REQUEST_TIMEOUT');child.kill('SIGKILL');},internal?2000:options.timeoutMs??15000);pending.set(message.id,{method,resolve,reject,timer});
   child.stdin.write(text,error=>{if(error){diagnostics.record({source:'client',stage:'output',code:'PIPE_ERROR',method});terminal('LOCAL_PIPE_CLOSED');}});
  });
 }
 async function request(method:LocalRequest['method'],params:unknown,internal=false):Promise<unknown>{
  if(method==='runtime.initialize'&&options.resolveCredential&&params&&typeof params==='object'&&!Array.isArray(params))params={...params,capabilities:[LOCAL_CREDENTIAL_CAPABILITY]};
  const result=await rawRequest(method,params,internal);
  if(method==='runtime.initialize'){const caps=(result as {capabilities?:string[]}).capabilities;broker.setNegotiated(Boolean(options.resolveCredential&&caps?.includes(LOCAL_CREDENTIAL_CAPABILITY)));}
  if(method==='live.authorize'||method==='speech.authorize'){const grant=method==='live.authorize'?LocalLiveGrantSchema.parse(result):LocalSpeechGrantSchema.parse(result),bindingKey=method==='live.authorize'?grant.sessionId:grant.sessionId+':'+(grant as {capability:string}).capability,prior=sessionGrants.get(bindingKey);if(prior&&prior!==grant.grantId)broker.revoke(prior);broker.setGrant({grantId:grant.grantId,credentialRef:grant.credentialRef,expiresAt:grant.expiresAt});sessionGrants.set(bindingKey,grant.grantId);}
  if(method==='live.revoke'||method==='speech.revoke'){const input=params as {sessionId:string;capability?:string},sessionId=input.sessionId+(method==='speech.revoke'?':'+input.capability:''),prior=sessionGrants.get(sessionId);if(prior)broker.revoke(prior);sessionGrants.delete(sessionId);}
  return result;
 }
 function validated<T>(schema:z.ZodType<T>,raw:unknown):T{const result=schema.safeParse(raw);if(!result.success)throw new LocalAgentClientError('LOCAL_RESPONSE_INVALID');return result.data;}
 let closeWork:Promise<void>|undefined;
 function close(){return closeWork??=(async()=>{
  if(closed)return;closing=true;broker.close();sessionGrants.clear();
  try{await request('runtime.shutdown',{},true);}catch{/* fall through to owned child termination */}child.stdin.end();
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([exited,new Promise<void>(resolve=>{timer=setTimeout(()=>{diagnostics.record({source:'client',stage:'shutdown',code:'FORCED_TERMINATION'});child.kill('SIGKILL');resolve();},2000);})]);}finally{clearTimeout(timer);}
  if(!closed){try{await Promise.race([exited,new Promise<never>((_r,reject)=>{timer=setTimeout(()=>reject(new LocalAgentClientError('LOCAL_SHUTDOWN_INCOMPLETE')),1000);})]);}finally{clearTimeout(timer);}}
  listeners.clear();
 })();}
 return{request,diagnostics:diagnostics.snapshot,
  getSession:async(sessionId:string)=>validated(LocalSessionViewSchema,await request('session.get',{sessionId})),
  listSessions:async(options:{offset?:number;limit?:number}={})=>validated(LocalSessionViewSchema.array().max(100),await request('session.list',options)),
  getAnswerPage:async(sessionId:string,options:LocalReadPageOptions={})=>validated(LocalAnswerPageSchema,await request('session.answers',{...options,sessionId})),
  getReport:async(sessionId:string,options:LocalReadPageOptions={})=>validated(LocalReportViewSchema.nullable(),await request('session.report',{...options,sessionId})),
  subscribe(fn:(event:LocalEvent)=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  async waitForJob(jobId:string){const end=Date.now()+30000;for(;;){const value=await request('job.get',{jobId}) as {status:string};if(!['queued','running'].includes(value.status))return value;if(Date.now()>=end)throw new LocalAgentClientError('LOCAL_JOB_TIMEOUT');await new Promise(r=>setTimeout(r,20));}},
  close,
 };
}
