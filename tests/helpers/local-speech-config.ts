import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnLocalAgent} from '../../packages/local-agent-client/src/index.ts';
import {makeSpeechFixture} from '../../experiments/speech/fixture.ts';
import cfg from '../../apps/agent/src/model-access/bailian.example.json' with {type:'json'};
import asr from '../../apps/agent/src/speech/qianwen-omni.example.json' with {type:'json'};
import {canonical} from '../../evals/answers/validation.ts';
export const speechSecrets={llm:'synthetic-speech-llm-private-do-not-store',asr:'synthetic-speech-asr-private-do-not-store',tts:'synthetic-speech-tts-private-do-not-store'};
export const limits={maxCalls:6,maxTotalTokens:100000,maxCostMicros:1000000};
export const liveConfig={...cfg,profile:{...cfg.profile,limits:{...cfg.profile.limits,...limits}},planning:'pi-knowledge',questionDelivery:'canonical'};
export function speechPolicy(){return{asrConfig:{...asr,enabled:true,authorization:{allowLive:true,expiresAt:Date.now()+120000}},ttsConfig:{enabled:true,endpoint:'https://cn-beijing.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation',model:'qwen3-tts-flash',voice:'Cherry',credentialEnv:'INTERVIEW_BAILIAN_ASR_API_KEY'},asrBudget:{maxCalls:2,maxAudioMs:120000,maxCostMicros:100000,reserveCostMicrosPerCall:100000},ttsBudget:{maxCalls:2,maxCharacters:6000,maxCostMicros:100000,reserveCostMicrosPerCall:100000},totalMaxCostMicros:1200000};}
export function check(ok:unknown,code:string):asserts ok{if(!ok)throw Error(code);}
export async function profileFiles(root:string):Promise<string[]>{const out:string[]=[];for(const entry of await readdir(root,{withFileTypes:true})){const path=join(root,entry.name);if(entry.isDirectory())out.push(...await profileFiles(path));else out.push(path);}return out;}
export async function speechAudit(dataDir:string){try{return(await readFile(join(dataDir,'speech-fixture-http.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)as {capability:string;kind:string;synthetic:boolean});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return[];throw e;}}
type Start=Omit<Parameters<typeof spawnLocalAgent>[0],'resolveCredential'>;
/** Synthetic user input is only fixture evidence, never an actual student's answer. */
export async function runSpeechStdioScenario(options:Start){
 const publicFrames:unknown[]=[],resolverCounts={llm:0,asr:0,tts:0};
 const connect=()=>spawnLocalAgent({...options,resolveCredential:async({credentialRef})=>{const capability=credentialRef==='synthetic-llm-ref'?'llm':credentialRef==='synthetic-asr-ref'?'asr':credentialRef==='synthetic-tts-ref'?'tts':undefined;check(capability,'FIXTURE_CREDENTIAL_REF_INVALID');resolverCounts[capability]++;return speechSecrets[capability];}});
 let client=await connect();
 const request=async(method:Parameters<typeof client.request>[0],params:unknown):Promise<any>=>{const result=await client.request(method,params);publicFrames.push(result);return result;};
 const run=async(method:Parameters<typeof client.request>[0],params:unknown)=>{const result=await request(method,params),job=await client.waitForJob(result.jobId)as {status:string;errorCode?:string};publicFrames.push(job);check(job.status==='completed','LOCAL_SPEECH_JOB_FAILED:'+method+':'+(job.errorCode??job.status));await request('job.events',{jobId:result.jobId,afterSeq:0});return result;};
 const cases:any[]=[];
 try{
  await request('runtime.initialize',{});client.subscribe(event=>publicFrames.push(event));
  for(const roleId of ['java-backend','web-frontend']as const){
   const before=(await speechAudit(options.dataDir)).length,c=await run('session.create',{operationId:'create-'+roleId,roleId,goal:'合成语音stdio离线注入验收',durationMinutes:20,mode:'live',liveConfig,sessionBudget:limits,speech:speechPolicy()});check((await speechAudit(options.dataDir)).length===before,'LOCAL_SPEECH_CREATE_HTTP');
   await request('live.authorize',{sessionId:c.sessionId,grantId:'llm-'+roleId,credentialRef:'synthetic-llm-ref',expectedVersion:0,expiresAt:Date.now()+120000,profile:liveConfig.profile});
   await run('session.nextQuestion',{sessionId:c.sessionId,operationId:'plan-'+roleId,expectedRevision:0});
   for(const capability of ['asr','tts'])await request('speech.authorize',{sessionId:c.sessionId,capability,grantId:capability+'-'+roleId,credentialRef:'synthetic-'+capability+'-ref',expectedVersion:0,expiresAt:Date.now()+120000});
   const f=makeSpeechFixture(roleId),beforeUpload=(await speechAudit(options.dataDir)).length,upload=await request('speech.upload.begin',{sessionId:c.sessionId,operationId:'upload-'+roleId,expectedRevision:1,byteLength:f.wavBytes.length,sha256:createHash('sha256').update(f.wavBytes).digest('hex')});
   for(let offset=0,index=0;offset<f.wavBytes.length;offset+=32768,index++)await request('speech.upload.chunk',{audioId:upload.audioId,index,base64:Buffer.from(f.wavBytes.subarray(offset,offset+32768)).toString('base64')});
   await request('speech.upload.finish',{audioId:upload.audioId});check((await speechAudit(options.dataDir)).length===beforeUpload,'LOCAL_SPEECH_UPLOAD_HTTP');
   const a=await run('speech.asr.start',{operationId:'asr-'+roleId,audioId:upload.audioId,expectedRevision:1}),transcript=await request('speech.task.get',{jobId:a.jobId});
   check(transcript.status==='transcribed'&&transcript.transcript.mode==='live-asr'&&transcript.transcript.originalText.startsWith('合成转写：'),'LOCAL_SPEECH_TRANSCRIPT_INVALID');
   const t=await run('speech.tts.start',{operationId:'tts-'+roleId,sessionId:c.sessionId,expectedRevision:1});let offset=0;const chunks:Buffer[]=[];
   for(;;){const part=await request('speech.audio.read',{jobId:t.jobId,offset});check(part.sampleRate===24000&&part.nextOffset>offset,'LOCAL_SPEECH_OUTPUT_INVALID');chunks.push(Buffer.from(part.base64,'base64'));offset=part.nextOffset;if(part.eof)break;}
   const wav=Buffer.concat(chunks);check(wav.subarray(0,4).toString()==='RIFF'&&wav.length===96044&&chunks.length>1,'LOCAL_SPEECH_WAV_INVALID');
   const confirmation={operationId:'confirm-'+roleId,jobId:a.jobId,expectedVersion:transcript.version,expectedRevision:1,text:transcript.transcript.originalText+'（合成确认文修改）'},answer=await run('speech.confirm',confirmation);
   check((await request('speech.confirm',confirmation)).jobId===answer.jobId,'LOCAL_SPEECH_CONFIRM_REPLAY');
   const view=await request('session.get',{sessionId:c.sessionId});check(view.mode==='live'&&view.answeredCount===1&&view.revision===2,'LOCAL_SPEECH_FORMAL_INVALID');
   await run('session.complete',{sessionId:c.sessionId,operationId:'complete-'+roleId,expectedRevision:2});
   const memory=await request('memory.get',{roleId}),modelBudget=await request('live.budget',{sessionId:c.sessionId}),speechBudget=await request('speech.budget',{sessionId:c.sessionId});
   check(modelBudget.totals.callsConsumed===3&&speechBudget.asr.callsConsumed===1&&speechBudget.tts.callsConsumed===1&&speechBudget.asr.heldCostMicros===100000&&speechBudget.tts.heldCostMicros===100000&&speechBudget.attempts.every((x:any)=>x.status==='responded')&&!speechBudget.vendorBillingVerified,'LOCAL_SPEECH_BUDGET_INVALID');
   check(memory.version===1&&memory.sessions.length===1&&memory.sessions[0].sessionId===c.sessionId&&memory.sessions[0].observations.length===1,'LOCAL_SPEECH_FORMAL_MEMORY_INVALID');
   cases.push({roleId,sessionId:c.sessionId,asrJobId:a.jobId,ttsJobId:t.jobId,transcript:transcript.transcript.originalText,memory,modelBudget,speechBudget,confirmedText:confirmation.text,completed:true,outputBytes:wav.length,outputChunks:chunks.length,restored:false});
  }
  const beforeRestart=canonical(resolverCounts),httpBefore=(await speechAudit(options.dataDir)).length;check(httpBefore===10,'LOCAL_SPEECH_HTTP_COUNT_INVALID');await client.close();client=await connect();await request('runtime.initialize',{});client.subscribe(event=>publicFrames.push(event));
  for(const c of cases){
   const view=await request('session.get',{sessionId:c.sessionId});check(view.phase==='completed'&&view.answeredCount===1,'LOCAL_SPEECH_RESTORE_SESSION');
   const transcript=await request('speech.task.get',{jobId:c.asrJobId});check(transcript.status==='confirmed'&&transcript.transcript.originalText===c.transcript&&transcript.answer.answer.text===c.confirmedText,'LOCAL_SPEECH_RESTORE_TRANSCRIPT');
   check(canonical(await request('memory.get',{roleId:c.roleId}))===canonical(c.memory),'LOCAL_SPEECH_RESTORE_MEMORY');
   check(canonical(await request('live.budget',{sessionId:c.sessionId}))===canonical(c.modelBudget),'LOCAL_SPEECH_RESTORE_MODEL_BUDGET');
   check(canonical(await request('speech.budget',{sessionId:c.sessionId}))===canonical(c.speechBudget),'LOCAL_SPEECH_RESTORE_BUDGET');
   try{await request('speech.audio.read',{jobId:c.ttsJobId,offset:0});throw Error('LOCAL_SPEECH_AUDIO_SURVIVED_RESTART');}catch(e){check((e as Error).message==='AUDIO_EXPIRED','LOCAL_SPEECH_AUDIO_RESTORE_ERROR');}c.restored=true;
  }
  const runtimeStatus=await request('runtime.status',{});check(runtimeStatus.modelHttpAttempts===0&&runtimeStatus.speechHttpAttempts===0&&runtimeStatus.executionStarts===0&&canonical(resolverCounts)===beforeRestart&&(await speechAudit(options.dataDir)).length===httpBefore,'LOCAL_SPEECH_RESTART_DISPATCHED');await client.close();
  const files=await profileFiles(options.dataDir);for(const key of Object.values(speechSecrets)){check(!JSON.stringify(publicFrames).includes(key),'LOCAL_SPEECH_PUBLIC_SECRET');for(const file of files)check(!(await readFile(file)).includes(Buffer.from(key)),'LOCAL_SPEECH_PERSISTED_SECRET');}
  const audit=await speechAudit(options.dataDir),syntheticHttpCalls={llm:audit.filter(a=>a.capability==='llm').length,asr:audit.filter(a=>a.capability==='asr').length,tts:audit.filter(a=>a.capability==='tts').length};check(syntheticHttpCalls.llm===6&&syntheticHttpCalls.asr===2&&syntheticHttpCalls.tts===2&&audit.every(a=>a.synthetic),'LOCAL_SPEECH_CAPABILITY_COUNTS');
  return{cases,resolverCounts,syntheticHttpCalls,httpAudit:audit,runtimeStatus,secretScan:{passed:true,filesScanned:files.length,scope:['public-rpc-responses','public-event-subscriptions','all-synthetic-profile-files']},restartAutomaticRequests:0,liveModelCalls:0,liveAsrCalls:0,liveTtsCalls:0};
 }finally{await client.close();}
}
