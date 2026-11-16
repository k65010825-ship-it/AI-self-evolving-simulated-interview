import {createAgentClient} from '../../../../packages/agent-client/src/index.ts';
import type {SpeechTaskCreate,SpeechOwner} from '../../../../packages/contracts/src/speech-task.ts';
import {ErrorCodeSchema,type RoleId} from '../../../../packages/contracts/src/tools.ts';import {PilotError} from './error.ts';import {createHash} from 'node:crypto';
export function createPilotGateway(config:{agentUrl:string;internalToken:string;fetch?:(url:string,init?:RequestInit)=>Promise<Response>}){
 const base=new URL(config.agentUrl);if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))throw Error('Invalid Agent endpoint');
 if(!/^[A-Za-z0-9_-]{32,256}$/.test(config.internalToken))throw Error('Invalid service token');const transport=config.fetch??globalThis.fetch;
 const client=createAgentClient({baseUrl:base.origin,internalToken:config.internalToken,...(config.fetch?{fetch:config.fetch}:{})});
 async function request(path:string,method:string,owner?:SpeechOwner,body?:unknown,raw?:Uint8Array){
  const response=await transport(`${base.origin}${path}`,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${config.internalToken}`,
   ...(owner?{'x-agent-user-id':owner.userId,'x-agent-role-id':owner.roleId}:{}),...(raw?{'content-type':'audio/wav'}:body!==undefined?{'content-type':'application/json'}:{})},
   ...(raw?{body:new Uint8Array(raw).buffer}:body!==undefined?{body:JSON.stringify(body)}:{})});
  const reader=response.body?.getReader();if(!reader)throw new PilotError('DEPENDENCY_UNAVAILABLE');let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>2*1024*1024)throw new PilotError('CONTEXT_BUDGET_EXCEEDED');chunks.push(r.value);}}
  finally{void reader.cancel().catch(()=>{});}let value:unknown;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new PilotError('DEPENDENCY_UNAVAILABLE');}
  if(!response.ok){const code=ErrorCodeSchema.safeParse((value as {code?:unknown}|null)?.code);throw new PilotError(code.success?code.data:'DEPENDENCY_UNAVAILABLE');}return value;
 }
 return{
  run:(request:Parameters<typeof client.executeRun>[0])=>client.executeRun(request,{timeoutMs:60000,maxReconnects:2}),
  async getRun(id:string){const existing=await client.getRun(id);return ['queued','running'].includes(existing.status)?client.waitForRun(id,{attemptId:existing.attemptId,timeoutMs:60000}):existing;},
  async questionAudio(input:{sessionId:string;userId:string;roleId:RoleId;questionId:string;text:string;deadlineAt:number}){
   const operationId='tts-'+createHash('sha256').update(JSON.stringify([input.sessionId,input.questionId,input.text])).digest('hex');
   const response=await transport(`${base.origin}/internal/v1/speech/synthesis`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(35000),headers:{authorization:`Bearer ${config.internalToken}`,'content-type':'application/json'},body:JSON.stringify({...input,operationId})});
   if(!response.ok)throw new PilotError('DEPENDENCY_UNAVAILABLE');const reader=response.body?.getReader();if(!reader)throw new PilotError('DEPENDENCY_UNAVAILABLE');const pieces:Uint8Array[]=[];let n=0;
   try{for(;;){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>8*1024*1024)throw new PilotError('CONTEXT_BUDGET_EXCEEDED');pieces.push(r.value);}}finally{void reader.cancel().catch(()=>{});}return new Uint8Array(Buffer.concat(pieces));
  },
  speech:{create:(r:SpeechTaskCreate)=>request('/internal/v1/speech/tasks','POST',undefined,r),
   upload:(id:string,o:SpeechOwner,b:Uint8Array)=>request(`/internal/v1/speech/tasks/${encodeURIComponent(id)}/audio`,'PUT',o,undefined,b),
   get:(id:string,o:SpeechOwner)=>request(`/internal/v1/speech/tasks/${encodeURIComponent(id)}`,'GET',o),
   confirm:(id:string,o:SpeechOwner,c:unknown)=>request(`/internal/v1/speech/tasks/${encodeURIComponent(id)}/confirmation`,'POST',o,c),
   cancel:(id:string,o:SpeechOwner)=>request(`/internal/v1/speech/tasks/${encodeURIComponent(id)}/cancellation`,'POST',o,{})},
 };
}
