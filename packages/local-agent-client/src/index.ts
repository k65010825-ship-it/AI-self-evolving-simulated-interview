import type {z} from 'zod';
import {LocalAnswerPageSchema,LocalReportViewSchema,type LocalReadPageOptions} from '../../contracts/src/local-presentation.ts';
import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import {isAbsolute} from 'node:path';
import {LocalRequestSchema,LocalResponseSchema,LocalNotificationSchema,LocalSessionViewSchema,type LocalRequest,type LocalEvent} from '../../contracts/src/local-runtime.ts';
import {createMainCredentialBroker,type LocalCredentialResolver} from './credential-broker.ts';
import {LOCAL_CREDENTIAL_CAPABILITY} from '../../contracts/src/local-credential.ts';
import {LocalSpeechGrantSchema} from '../../contracts/src/local-speech.ts';
import {LocalLiveGrantSchema} from '../../contracts/src/local-live.ts';
export class LocalAgentClientError extends Error{constructor(readonly code:string){super(code);}}
/** Main-process SDK only. No Electron imports, ports, credentials or inherited provider environment. */
export async function spawnLocalAgent(options:{executable:string;entry:string;dataDir:string;assetsRoot:string;cwd:string;timeoutMs?:number;resolveCredential?:LocalCredentialResolver}){
 for(const p of [options.executable,options.entry,options.dataDir,options.assetsRoot,options.cwd])if(!isAbsolute(p))throw new LocalAgentClientError('LOCAL_PATH_INVALID');
 const env:NodeJS.ProcessEnv={};for(const key of ['SystemRoot','WINDIR','ComSpec','TEMP','TMP','OS','PATHEXT'])if(process.env[key])env[key]=process.env[key];
 const child=spawn(options.executable,['--no-env-file',options.entry,'--data-dir',options.dataDir,'--assets-root',options.assetsRoot],{cwd:options.cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let closed=false,closing=false,faulted=false,pendingText='';const decoder=new TextDecoder('utf-8',{fatal:true});
 const ownerToken={},sessionGrants=new Map<string,string>();
 const broker=createMainCredentialBroker({ownerToken,resolveCredential:options.resolveCredential??(async()=>undefined),send:frame=>new Promise<void>((resolve,reject)=>{if(closed||faulted){reject(new LocalAgentClientError('LOCAL_PIPE_CLOSED'));return;}child.stdin.write(JSON.stringify(frame)+'\n',error=>error?reject(new LocalAgentClientError('LOCAL_PIPE_CLOSED')):resolve());})});
 const pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>(),listeners=new Set<(event:LocalEvent)=>void>();
 let resolveExit!:(code:number|null)=>void;const exited=new Promise<number|null>(resolve=>{resolveExit=resolve;});
 function fail(code:string){broker.close();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new LocalAgentClientError(code));}pending.clear();}
 child.stderr.on('data',()=>{}); // Drain without forwarding dependency text.
 child.stdin.on('error',()=>fail('LOCAL_PIPE_CLOSED'));
 child.once('error',()=>{closed=true;fail('LOCAL_PROCESS_FAILED');resolveExit(null);});
 child.once('exit',code=>{closed=true;fail('LOCAL_PROCESS_EXITED');resolveExit(code);});
 child.stdout.on('data',(chunk:Buffer)=>{try{pendingText+=decoder.decode(chunk,{stream:true});let at:number;
  while((at=pendingText.indexOf('\n'))>=0){const text=pendingText.slice(0,at);pendingText=pendingText.slice(at+1);if(Buffer.byteLength(text)>1024*1024)throw Error();const raw=JSON.parse(text);
   if(raw&&typeof raw==='object'&&['credential-request','credential-cancel'].includes(raw.type)){void broker.handle(raw,ownerToken);continue;}
   const notification=LocalNotificationSchema.safeParse(raw);
   if(notification.success){for(const fn of listeners)try{fn(notification.data.event);}catch{}continue;}
   const response=LocalResponseSchema.parse(raw),p=pending.get(response.id);if(!p)throw Error();pending.delete(response.id);clearTimeout(p.timer);if(response.ok)p.resolve(response.result);else p.reject(new LocalAgentClientError(response.error.code));
  }if(Buffer.byteLength(pendingText)>1024*1024)throw Error();
 }catch{faulted=true;fail('LOCAL_PROTOCOL_INVALID');child.kill('SIGKILL');}});
 function rawRequest(method:LocalRequest['method'],params:unknown,internal=false):Promise<unknown>{
  if(closed||faulted||closing&&!internal)return Promise.reject(new LocalAgentClientError('LOCAL_PROCESS_CLOSED'));if(pending.size>=8)return Promise.reject(new LocalAgentClientError('RATE_LIMITED'));
  const message=LocalRequestSchema.parse({protocolVersion:1,type:'request',id:randomUUID(),method,params}),text=JSON.stringify(message)+'\n';if(Buffer.byteLength(text)>1024*1024)return Promise.reject(new LocalAgentClientError('LOCAL_FRAME_LIMIT'));
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(message.id);reject(new LocalAgentClientError('LOCAL_REQUEST_TIMEOUT'));child.kill('SIGKILL');},internal?2000:options.timeoutMs??15000);pending.set(message.id,{resolve,reject,timer});
   child.stdin.write(text,error=>{if(error){const p=pending.get(message.id);if(p){clearTimeout(p.timer);pending.delete(message.id);p.reject(new LocalAgentClientError('LOCAL_PIPE_CLOSED'));}}});
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
 return{request,
  getSession:async(sessionId:string)=>validated(LocalSessionViewSchema,await request('session.get',{sessionId})),
  listSessions:async(options:{offset?:number;limit?:number}={})=>validated(LocalSessionViewSchema.array().max(100),await request('session.list',options)),
  getAnswerPage:async(sessionId:string,options:LocalReadPageOptions={})=>validated(LocalAnswerPageSchema,await request('session.answers',{...options,sessionId})),
  getReport:async(sessionId:string,options:LocalReadPageOptions={})=>validated(LocalReportViewSchema.nullable(),await request('session.report',{...options,sessionId})),
  subscribe(fn:(event:LocalEvent)=>void){listeners.add(fn);return()=>{listeners.delete(fn);};},
  async waitForJob(jobId:string){const end=Date.now()+30000;for(;;){const value=await request('job.get',{jobId}) as {status:string};if(!['queued','running'].includes(value.status))return value;if(Date.now()>=end)throw new LocalAgentClientError('LOCAL_JOB_TIMEOUT');await new Promise(r=>setTimeout(r,20));}},
  async close(){if(closed)return;if(closing){await exited;return;}closing=true;
   broker.close();sessionGrants.clear();
   try{await request('runtime.shutdown',{},true);}catch{/* fall through to owned child termination */}child.stdin.end();
   let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([exited,new Promise<void>(resolve=>{timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},2000);})]);}finally{clearTimeout(timer);}
   if(!closed){try{await Promise.race([exited,new Promise<never>((_r,reject)=>{timer=setTimeout(()=>reject(new LocalAgentClientError('LOCAL_SHUTDOWN_INCOMPLETE')),1000);})]);}finally{clearTimeout(timer);}}listeners.clear();
  },
 };
}
