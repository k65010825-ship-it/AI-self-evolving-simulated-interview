import {test,expect} from 'bun:test';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {createLocalHost} from '../apps/agent/src/local/host.ts';import {makeSpeechFixture} from '../experiments/speech/fixture.ts';
import asrConfig from '../apps/agent/src/speech/qianwen-omni.example.json' with {type:'json'};
export const speechPolicy={asrConfig,ttsConfig:{enabled:false,endpoint:'https://cn-beijing.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation',model:'qwen3-tts-flash',voice:'Cherry',credentialEnv:'INTERVIEW_BAILIAN_ASR_API_KEY'},asrBudget:{maxCalls:6,maxAudioMs:120000,maxCostMicros:1000000,reserveCostMicrosPerCall:10000},ttsBudget:{maxCalls:6,maxCharacters:6000,maxCostMicros:1000000,reserveCostMicrosPerCall:10000},totalMaxCostMicros:2000000};
test('local speech two-role upload, explicit ASR, confirmation scoring and TTS use the local host and survive restart without replay',async()=>{
 const root=await mkdtemp(join(tmpdir(),'local-speech-host-'));let h=await createLocalHost({dataDir:root,assetsRoot:process.cwd()});
 try{for(const roleId of ['java-backend','web-frontend']as const){const f=makeSpeechFixture(roleId),c=h.command('session.create',{operationId:'c-'+roleId,roleId,goal:'离线语音验收',durationMinutes:20,speech:speechPolicy});await h.wait(c.jobId);
  const p=h.command('session.nextQuestion',{operationId:'p-'+roleId,sessionId:c.sessionId,expectedRevision:0});await h.wait(p.jobId);
  const up=h.speech('speech.upload.begin',{operationId:'up-'+roleId,sessionId:c.sessionId,expectedRevision:1,byteLength:f.wavBytes.length,sha256:createHash('sha256').update(f.wavBytes).digest('hex')})as {audioId:string};
  for(let offset=0,index=0;offset<f.wavBytes.length;offset+=32768,index++)h.speech('speech.upload.chunk',{audioId:up.audioId,index,base64:Buffer.from(f.wavBytes.subarray(offset,offset+32768)).toString('base64')});
  h.speech('speech.upload.finish',{audioId:up.audioId});
  const asr=h.speech('speech.asr.start',{operationId:'asr-'+roleId,audioId:up.audioId,expectedRevision:1})as {jobId:string};await h.wait(asr.jobId);
  const transcript=h.speech('speech.task.get',{jobId:asr.jobId})as {status:string;version:number;transcript:{mode:string;originalText:string}};expect(transcript).toMatchObject({status:'transcribed',transcript:{mode:'offline-fixture'}});
  const tts=h.speech('speech.tts.start',{operationId:'tts-'+roleId,sessionId:c.sessionId,expectedRevision:1})as {jobId:string};await h.wait(tts.jobId);expect(h.job(tts.jobId).status).toBe('completed');
  const audio=h.speech('speech.audio.read',{jobId:tts.jobId,offset:0})as {base64:string;sampleRate:number};expect(audio.sampleRate).toBe(24000);expect(Buffer.from(audio.base64,'base64').subarray(0,4).toString()).toBe('RIFF');
  const confirmation={operationId:'confirm-'+roleId,jobId:asr.jobId,expectedVersion:transcript.version,expectedRevision:1,text:transcript.transcript.originalText+'。'},a=h.speech('speech.confirm',confirmation)as {jobId:string};await h.wait(a.jobId);expect(h.job(a.jobId).status).toBe('completed');expect(h.session(c.sessionId).revision).toBe(2);
  expect(h.speech('speech.confirm',confirmation)).toMatchObject({jobId:a.jobId});await h.close();h=await createLocalHost({dataDir:root,assetsRoot:process.cwd()});expect(h.status().executionStarts).toBe(0);expect(()=>h.speech('speech.audio.read',{jobId:tts.jobId,offset:0})).toThrow('AUDIO_EXPIRED');expect(h.speech('speech.task.get',{jobId:asr.jobId})).toMatchObject({status:'confirmed'});
 }}finally{await h.close();await rm(root,{recursive:true,force:true});}
},30000);
