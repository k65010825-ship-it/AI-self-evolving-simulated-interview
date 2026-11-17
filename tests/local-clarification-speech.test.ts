import {test,expect} from 'bun:test';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {createLocalHost} from '../apps/agent/src/local/host.ts';import {makeSpeechFixture} from '../experiments/speech/fixture.ts';
import asrConfig from '../apps/agent/src/speech/qianwen-omni.example.json' with {type:'json'};
const speech={asrConfig,ttsConfig:{enabled:false,endpoint:'https://cn-beijing.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation',model:'qwen3-tts-flash',voice:'Cherry',credentialEnv:'INTERVIEW_BAILIAN_ASR_API_KEY'},asrBudget:{maxCalls:6,maxAudioMs:120000,maxCostMicros:1000000,reserveCostMicrosPerCall:10000},ttsBudget:{maxCalls:6,maxCharacters:6000,maxCostMicros:1000000,reserveCostMicrosPerCall:10000},totalMaxCostMicros:2000000};
test('both roles can confirm synthetic speech as the current text clarification supplement without losing source identity',async()=>{
 const data=await mkdtemp(join(tmpdir(),'clarification-speech-'));const h=await createLocalHost({dataDir:data,assetsRoot:process.cwd()});
 try{for(const roleId of ['java-backend','web-frontend'] as const){
  const c=h.command('session.create',{operationId:'create-'+roleId,roleId,goal:'speech continuity',durationMinutes:20,speech});await h.wait(c.jobId);
  const p=h.command('session.nextQuestion',{operationId:'plan-'+roleId,sessionId:c.sessionId,expectedRevision:0});await h.wait(p.jobId);
  const a=h.command('session.answer',{operationId:'answer-'+roleId,sessionId:c.sessionId,expectedRevision:1,text:'不懂'});await h.wait(a.jobId);expect(h.session(c.sessionId).needsClarification).toBe(true);
  const fixture=makeSpeechFixture(roleId),up=h.speech('speech.upload.begin',{operationId:'upload-'+roleId,sessionId:c.sessionId,expectedRevision:2,byteLength:fixture.wavBytes.length,sha256:createHash('sha256').update(fixture.wavBytes).digest('hex')}) as {audioId:string};
  for(let offset=0,index=0;offset<fixture.wavBytes.length;offset+=32768,index++)h.speech('speech.upload.chunk',{audioId:up.audioId,index,base64:Buffer.from(fixture.wavBytes.subarray(offset,offset+32768)).toString('base64')});
  h.speech('speech.upload.finish',{audioId:up.audioId});
  const asr=h.speech('speech.asr.start',{operationId:'asr-'+roleId,audioId:up.audioId,expectedRevision:2}) as {jobId:string};await h.wait(asr.jobId);
  const transcript=h.speech('speech.task.get',{jobId:asr.jobId}) as {version:number;transcript:{originalText:string}};
  const command={operationId:'confirm-'+roleId,jobId:asr.jobId,expectedVersion:transcript.version,expectedRevision:2,text:'不懂；补充：'+transcript.transcript.originalText};
  const confirmed=h.speech('speech.confirm',command) as {jobId:string};await h.wait(confirmed.jobId);expect(h.job(confirmed.jobId)).toHaveProperty('status','completed');
  expect(h.session(c.sessionId)).toMatchObject({revision:3,needsClarification:false,scoredCount:1});
  expect(h.speech('speech.confirm',command)).toMatchObject(confirmed);
  const close=h.command('session.complete',{operationId:'finish-'+roleId,sessionId:c.sessionId,expectedRevision:3});await h.wait(close.jobId);expect(h.job(close.jobId)).toHaveProperty('status','completed');
  expect(h.session(c.sessionId).report?.coverage).toMatchObject({totalAnswers:1,scoredAnswers:1});
 }
 expect(h.status()).toMatchObject({modelHttpAttempts:0,speechHttpAttempts:0});
 }finally{await h.close();await rm(data,{recursive:true,force:true});}
},15000);
