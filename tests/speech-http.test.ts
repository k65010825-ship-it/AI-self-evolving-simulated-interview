import {test,expect} from 'bun:test';
import {mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createAgentApp} from '../apps/agent/src/app.ts';
import {createSpeechTaskManager} from '../apps/agent/src/speech/task-manager.ts';
import {makeSpeechFixture} from '../experiments/speech/fixture.ts';
import {createHash} from 'node:crypto';
import {readSpeechBody} from '../apps/agent/src/speech/http-body.ts';
const token='speech_test_token_only_01234567890123456789';
function fixture(){const f=makeSpeechFixture(),id='http-speech';return{...f,id,request:{speechId:id,context:{...f.input.context,runId:id},
 binding:{sessionId:'session-1',questionId:'question-1',answerId:'answer-1',sessionVersion:1},audio:{sha256:createHash('sha256').update(f.wavBytes).digest('hex'),byteLength:f.wavBytes.length}}};}
test('authenticated raw WAV routes register/upload/poll/confirm stored source and fence wrong owner',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'speech-http-')),f=fixture();let calls=0;
 const speech=createSpeechTaskManager({path:join(dir,'speech.sqlite'),authorize:async({request})=>request.context.userId===f.input.context.userId,
  providerFor:()=>({...f.provider,transcribe:async i=>{calls++;return f.provider.transcribe(i,new AbortController().signal);}})});
 const app=createAgentApp({speech,internalToken:token}),base='/internal/v1/speech/tasks';
 const headers={authorization:`Bearer ${token}`,'x-agent-user-id':f.input.context.userId,'x-agent-role-id':'java-backend'};
 try{
  expect((await app.request(base,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.request)})).status).toBe(401);
  const created=await app.request(base,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(f.request)});expect(created.status).toBe(201);
  const uploaded=await app.request(`${base}/${f.id}/audio`,{method:'PUT',headers:{...headers,'content-type':'audio/wav'},body:f.wavBytes});expect(uploaded.status).toBe(202);
  await speech.wait(f.id);
  const readyResponse=await app.request(`${base}/${f.id}`,{headers});expect(readyResponse.status).toBe(200);const ready=await readyResponse.json() as {version:number;status:string};expect(ready.status).toBe('transcribed');
  const wrong=await app.request(`${base}/${f.id}`,{headers:{...headers,'x-agent-user-id':'wrong'}});expect(wrong.status).toBe(403);
  const confirmation={expectedVersion:ready.version,text:f.text+'。'};
  const confirmed=await app.request(`${base}/${f.id}/confirmation`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(confirmation)});
  expect(confirmed.status).toBe(200);const body=await confirmed.json() as {answer:{transcription:{originalText:string};answer:{id:string;text:string}}};
  expect(body.answer.answer.text).toBe(confirmation.text);expect(body.answer.transcription.originalText).toBe(f.text);
  expect((await app.request(`${base}/${f.id}/audio`,{method:'PUT',headers:{...headers,'content-type':'audio/wav'},body:f.wavBytes})).status).toBe(200);expect(calls).toBe(1);
  expect((await app.request(`${base}/${f.id}`,{headers:{...headers,'x-agent-role-id':'web-frontend'}})).status).toBe(403);
 }finally{await speech.wait(f.id);speech.close();for(const n of readdirSync(dir))unlinkSync(join(dir,n));rmdirSync(dir);}
});
test('speech route opt-in, missing headers, unsupported MIME and streamed oversized WAV reject safely',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'speech-http-')),f=fixture();let calls=0;
 const speech=createSpeechTaskManager({path:join(dir,'speech.sqlite'),authorize:async()=>true,providerFor:()=>{calls++;return f.provider;}});
 const app=createAgentApp({speech,internalToken:token}),path=`/internal/v1/speech/tasks/${f.id}/audio`;
 const owner={authorization:`Bearer ${token}`,'x-agent-user-id':f.input.context.userId,'x-agent-role-id':'java-backend'};
 try{await speech.create(f.request);
  expect((await createAgentApp().request('/internal/v1/speech/tasks',{method:'POST'})).status).toBe(501);
  expect((await app.request(path,{method:'PUT',headers:{authorization:`Bearer ${token}`,'content-type':'audio/wav'},body:f.wavBytes})).status).toBe(422);
  expect((await app.request(path,{method:'PUT',headers:{...owner,'content-type':'audio/webm'},body:f.wavBytes})).status).toBe(422);
  const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(4194305));c.close();}});
  const response=await app.request(path,{method:'PUT',headers:{...owner,'content-type':'audio/wav','content-length':'44'},body:stream,duplex:'half'} as RequestInit);
  expect(response.status).toBe(413);expect(calls).toBe(0);
 }finally{speech.close();for(const n of readdirSync(dir))unlinkSync(join(dir,n));rmdirSync(dir);}
});
test('bounded WAV reader times out or cancels ignored read and releases its source',async()=>{
 let cancelled=0;const stream=()=>new ReadableStream<Uint8Array>({cancel(){cancelled++;}});
 const req=new Request('http://localhost/upload',{method:'PUT',body:stream(),duplex:'half'} as RequestInit);
 await expect(readSpeechBody(req,1024,10)).rejects.toThrow('DEADLINE_EXCEEDED');expect(cancelled).toBe(1);
 const ctl=new AbortController(),request=new Request('http://localhost/upload',{method:'PUT',body:stream(),signal:ctl.signal,duplex:'half'} as RequestInit);
 const pending=readSpeechBody(request,1024,1000);ctl.abort();await expect(pending).rejects.toThrow('RUN_CANCELLED');expect(cancelled).toBe(2);
});
test('HTTP admission limits bytes retained before read, including concurrent duplicate uploads',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'speech-http-')),f=fixture();let reads=0,cancelled=0,release:(()=>void)|undefined;
 const speech=createSpeechTaskManager({path:join(dir,'speech.sqlite'),maxRunning:1,authorize:async()=>true,providerFor:()=>f.provider});
 const app=createAgentApp({speech,internalToken:token}),headers={authorization:`Bearer ${token}`,'x-agent-user-id':f.input.context.userId,'x-agent-role-id':'java-backend','content-type':'audio/wav'};
 try{await speech.create(f.request);release=speech.acquireHttpSlot(f.id);
  const source=new ReadableStream<Uint8Array>({pull(c){reads++;c.enqueue(f.wavBytes);c.close();},cancel(){cancelled++;}},{highWaterMark:0});
  const res=await app.request(`/internal/v1/speech/tasks/${f.id}/audio`,{method:'PUT',headers,body:source,duplex:'half'} as RequestInit);
  expect(res.status).toBe(429);expect(reads).toBe(0);expect(cancelled).toBe(1);
  release();release=undefined;
  const accepted=await app.request(`/internal/v1/speech/tasks/${f.id}/audio`,{method:'PUT',headers,body:f.wavBytes});expect(accepted.status).toBe(202);
  await speech.wait(f.id);
 }finally{release?.();speech.close();for(const n of readdirSync(dir))unlinkSync(join(dir,n));rmdirSync(dir);}
});
