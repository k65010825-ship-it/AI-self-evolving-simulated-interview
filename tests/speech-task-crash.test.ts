import {test,expect} from 'bun:test';
import {mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {makeSpeechFixture} from '../experiments/speech/fixture.ts';
import {createSpeechTaskManager} from '../apps/agent/src/speech/task-manager.ts';
test('actual child exit after dispatched checkpoint restores interrupted hold without network replay',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'speech-crash-')),path=join(directory,'tasks.sqlite'),f=makeSpeechFixture(),at=Date.now();
 const request={speechId:'speech-crash',context:{...f.input.context,runId:'speech-crash',deadlineAt:at+60000},binding:{sessionId:'session',questionId:'question',answerId:'answer',sessionVersion:1},
  audio:{sha256:createHash('sha256').update(f.wavBytes).digest('hex'),byteLength:f.wavBytes.length}};
 const script=`import {createSpeechTaskManager} from './apps/agent/src/speech/task-manager.ts';
 import {createAsrProvider} from './apps/agent/src/speech/bailian-asr.ts';import config from './apps/agent/src/speech/qianwen-omni.example.json';
 import {makeSpeechFixture} from './experiments/speech/fixture.ts';
 const m=createSpeechTaskManager({path:${JSON.stringify(path)},now:()=>${at},authorize:async()=>true,
  providerFor:({context,onCheckpoint})=>createAsrProvider({...config,enabled:true,authorization:{allowLive:true,expiresAt:${at+60000}}},
   {context,onCheckpoint,now:()=>${at},readCredential:()=> 'synthetic',fetch:async()=>{process.exit(23);}})});
 const request=${JSON.stringify(request)};await m.create(request);await m.upload(request.speechId,{userId:request.context.userId,roleId:request.context.roleId},makeSpeechFixture().wavBytes);await m.wait(request.speechId);`;
 const child=Bun.spawn([process.execPath,'--eval',script],{cwd:process.cwd(),stdout:'ignore',stderr:'pipe'});
 let timer:ReturnType<typeof setTimeout>|undefined,m:ReturnType<typeof createSpeechTaskManager>|undefined;
 try{const code=await Promise.race([child.exited,new Promise<never>((_r,reject)=>{timer=setTimeout(()=>{child.kill();reject(Error('child timeout'));},10000);})]);expect(code).toBe(23);
  let calls=0;m=createSpeechTaskManager({path,now:()=>at+30001,authorize:async()=>true,providerFor:()=>{calls++;return f.provider;}});
  const owner={userId:request.context.userId,roleId:request.context.roleId},s=await m.snapshot(request.speechId,owner);
  expect(s.status).toBe('interrupted');expect(s.accounting?.entries[0]?.status).toBe('unknown');expect(s.accounting?.heldCostMicros).toBe(100000);
  await m.upload(request.speechId,owner,f.wavBytes);expect(calls).toBe(0);
 }finally{if(timer)clearTimeout(timer);m?.close();for(const name of readdirSync(directory))unlinkSync(join(directory,name));rmdirSync(directory);}
});
