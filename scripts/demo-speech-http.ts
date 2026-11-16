import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createAgentApp} from '../apps/agent/src/app.ts';
import {createSpeechTaskManager} from '../apps/agent/src/speech/task-manager.ts';
import {createAsrProvider} from '../apps/agent/src/speech/bailian-asr.ts';
import config from '../apps/agent/src/speech/qianwen-omni.example.json' with {type:'json'};
import {SpeechTaskSnapshotSchema} from '../packages/contracts/src/speech-task.ts';
import {makeSpeechFixture} from '../experiments/speech/fixture.ts';
import type {RoleId} from '../packages/contracts/src/tools.ts';
/** Local TCP and real SQLite; injected upstream HTTP and manual text are NOT speech recognition. */
export async function runSpeechHttpDemo(roleId:RoleId='java-backend'){
 const f=makeSpeechFixture(roleId),directory=mkdtempSync(join(tmpdir(),'speech-http-demo-')),path=join(directory,'speech.sqlite');
 const speechId=`speech-http-demo-${roleId}`,request={speechId,context:{...f.input.context,runId:speechId},
  binding:{sessionId:'fixture-session',questionId:'fixture-question',answerId:'fixture-answer',sessionVersion:1},
  audio:{sha256:createHash('sha256').update(f.wavBytes).digest('hex'),byteLength:f.wavBytes.length}};
 let injectedAsrCalls=0;
 const deps={path,authorize:async({request:r}:{request:typeof request})=>r.context.userId===request.context.userId&&r.context.roleId===roleId&&
  JSON.stringify(r.binding)===JSON.stringify(request.binding),
  providerFor:({context,onCheckpoint}:Parameters<Parameters<typeof createSpeechTaskManager>[0]['providerFor']>[0])=>createAsrProvider(
   {...config,enabled:true,authorization:{allowLive:true,expiresAt:Date.now()+60000}},
   {context,onCheckpoint,readCredential:()=> 'synthetic-no-real-key',fetch:async()=>{injectedAsrCalls++;
    return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:f.text},finish_reason:'stop'}]})+'\n\n'+
     'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})+'\n\ndata: [DONE]\n\n');}})};
 let speech=createSpeechTaskManager(deps),server:Bun.Server<undefined>|undefined;
 const token=randomBytes(32).toString('hex'),ownerHeaders={'x-agent-user-id':request.context.userId,'x-agent-role-id':roleId};
 const boot=()=>Bun.serve({hostname:'127.0.0.1',port:0,fetch:createAgentApp({speech,internalToken:token}).fetch});
 const call=async(suffix:string,method='GET',body?:string|Uint8Array)=>{
  const response=await fetch(`http://127.0.0.1:${server!.port}/internal/v1/speech/tasks${suffix}`,{method,redirect:'error',
   headers:{authorization:`Bearer ${token}`,...ownerHeaders,...(body!==undefined?{'content-type':typeof body==='string'?'application/json':'audio/wav'}:{})},
   ...(body!==undefined?{body:typeof body==='string'?body:new Uint8Array(body).buffer}:{}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error(`Speech demo HTTP ${response.status}`);return SpeechTaskSnapshotSchema.parse(await response.json());
 };
 try{server=boot();await call('','POST',JSON.stringify(request));await call(`/${speechId}/audio`,'PUT',f.wavBytes);await speech.wait(speechId);
  const ready=await call(`/${speechId}`),confirmed=await call(`/${speechId}/confirmation`,'POST',JSON.stringify({expectedVersion:ready.version,text:f.text+'。'}));
  await call(`/${speechId}/audio`,'PUT',f.wavBytes);
  await server.stop(true);server=undefined;speech.close();speech=createSpeechTaskManager(deps);server=boot();
  const reopened=await call(`/${speechId}`);await call(`/${speechId}/audio`,'PUT',f.wavBytes);
  return{roleId,transport:'tcp',asrTransport:'injected-http',audioSource:'generated-sine-and-silence',asrTextSource:'hand-authored',
   status:confirmed.status,reopenedStatus:reopened.status,injectedAsrCalls,liveAsrCalls:0,formalCommitted:false,vendorBillingVerified:false,
   originalText:reopened.transcript!.originalText,confirmedText:reopened.answer!.answer.text,heldCostMicros:reopened.accounting!.heldCostMicros};
 }finally{await server?.stop(true);await speech.wait(speechId);speech.close();for(const n of readdirSync(directory))unlinkSync(join(directory,n));rmdirSync(directory);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const role of ['java-backend','web-frontend'] as const)console.log(JSON.stringify(await runSpeechHttpDemo(role)));
}
