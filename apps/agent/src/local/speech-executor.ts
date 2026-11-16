import {ToolContextSchema,type ToolContext} from '../../../../packages/contracts/src/tools.ts';
import {TtsInputSchema} from '../../../../packages/contracts/src/tts.ts';
import type {SpeechTranscript} from '../../../../packages/contracts/src/speech.ts';
import {AgentStateError} from '../planning/interview-state.ts';
import {createAsrProvider} from '../speech/bailian-asr.ts';
import {transcribeSpeech,type SpeechProvider} from '../speech/transcribe.ts';
import {synthesizeTts} from '../speech/tts.ts';

export type LocalSpeechState='dispatched'|'responded'|'rejected'|'unknown';
export interface LocalSpeechMetadata {
 httpStatus?:number;
 audioMs?:number;
 reservedCostMicros?:number;
 usage?:{inputTokens:number;outputTokens:number;totalTokens:number};
}
export interface LocalSpeechDependencies {
 /** Private broker result. Never resolve credentials from process environment or global config. */
 credential?:string;
 fetch?:(url:string,init:RequestInit)=>Promise<Response>;
 now?:()=>number;
 signal?:AbortSignal;
 /** Synchronous durable checkpoint. The host has already reserved this attempt. */
 onState:(state:LocalSpeechState,metadata?:LocalSpeechMetadata)=>void;
}
type Mode='offline-fixture'|'live';
export interface LocalAsrInput {context:ToolContext;audioId:string;transcriptionId?:string;wavBytes:Uint8Array;config:unknown;mode:Mode;}
export interface LocalTtsInput {context:ToolContext;text:string;operationId:string;config:unknown;mode:Mode;}
export type LocalTtsOutput=Omit<Awaited<ReturnType<typeof synthesizeTts>>,'modelId'>&{modelId:string};

function preflight(input:{context:ToolContext;mode:Mode},deps:LocalSpeechDependencies){
 if(!ToolContextSchema.safeParse(input.context).success||!['offline-fixture','live'].includes(input.mode)||typeof deps.onState!=='function')throw new AgentStateError('VALIDATION_ERROR');
 if(deps.signal?.aborted)throw new AgentStateError('RUN_CANCELLED');
 const now=(deps.now??Date.now)();
 if(!Number.isSafeInteger(now)||now<0)throw new AgentStateError('VALIDATION_ERROR');
 if(now>=input.context.deadlineAt)throw new AgentStateError('DEADLINE_EXCEEDED');
}
function states(deps:LocalSpeechDependencies){
 let dispatched=false,failed=false,last:LocalSpeechState|undefined;
 const emit=(state:LocalSpeechState,metadata?:LocalSpeechMetadata)=>{
  // A failed dispatch persistence hook has never granted HTTP permission.
  if(failed)return;
  try{
   const result:unknown=deps.onState(state,metadata);
   if(result&&typeof(result as {then?:unknown}).then==='function'){
    void Promise.resolve(result).catch(()=>{});throw new Error('asynchronous checkpoint');
   }
   if(state==='dispatched')dispatched=true;
   last=state;
  }catch{failed=true;throw new AgentStateError('DEPENDENCY_UNAVAILABLE');}
 };
 return{emit,unknown:()=>{if(dispatched&&!failed&&last!=='unknown'&&last!=='rejected')emit('unknown');}};
}
function sanitize(error:unknown):AgentStateError{return error instanceof AgentStateError?error:new AgentStateError('DEPENDENCY_UNAVAILABLE');}

/** Executes one reserved ASR attempt through the existing provider; never retries. */
export async function runLocalAsr(input:LocalAsrInput,deps:LocalSpeechDependencies):Promise<SpeechTranscript>{
 preflight(input,deps);const state=states(deps);
 try{
  const provider:SpeechProvider=input.mode==='offline-fixture'?{
   id:'local-synthetic-asr-fixture',version:'1',mode:'offline-fixture',
   transcribe:async()=>({text:'合成音频离线转写：这是用于本地链路验证的模拟回答。',language:'zh-CN',segments:[]}),
  }:createAsrProvider(input.config,{
   context:input.context,readCredential:()=>deps.credential,...(deps.fetch?{fetch:deps.fetch}:{}),...(deps.now?{now:deps.now}:{}),
   onCheckpoint:snapshot=>{
    const entry=snapshot.entries.at(-1);if(!entry)return;
    state.emit(entry.status,{...(entry.httpStatus!==undefined?{httpStatus:entry.httpStatus}:{}),audioMs:entry.audioMs,reservedCostMicros:entry.reservedCostMicros,...(entry.usage?{usage:{...entry.usage}}:{})});
   },
  });
  const transcript=await transcribeSpeech({context:input.context,transcriptionId:input.transcriptionId??input.audioId,audioId:input.audioId,wavBytes:input.wavBytes},
   {provider,...(deps.now?{now:deps.now}:{}),timeoutMs:30000},deps.signal);
  // Treat a provider echoing its private bearer as invalid output, never public text.
  if(input.mode==='live'&&deps.credential&&JSON.stringify(transcript).includes(deps.credential))throw new AgentStateError('MODEL_OUTPUT_INVALID');
  return transcript;
 }catch(error){state.unknown();throw sanitize(error);}
}

/** Executes one reserved TTS attempt, recording HTTP rejection separately from parse success. */
export async function runLocalTts(input:LocalTtsInput,deps:LocalSpeechDependencies):Promise<LocalTtsOutput>{
 preflight(input,deps);
 const parsed=TtsInputSchema.safeParse({text:input.text,operationId:input.operationId,deadlineAt:input.context.deadlineAt});
 if(!parsed.success)throw new AgentStateError('VALIDATION_ERROR');
 if(input.mode==='offline-fixture'){
  // Explicit synthetic 24kHz silence: no provider construction, credential access, HTTP or paid checkpoint.
  const wav=Buffer.alloc(524);wav.write('RIFF');wav.writeUInt32LE(516,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(480,40);
  return{wavBytes:new Uint8Array(wav),characters:[...parsed.data.text].length,providerId:'local-synthetic-tts-fixture',modelId:'synthetic-pcm-silence-v1'};
 }
 const state=states(deps);let httpStatus:number|undefined;
 try{return await synthesizeTts(parsed.data,input.config,{
  readCredential:()=>deps.credential,...(deps.signal?{signal:deps.signal}:{}),
  fetch:async(url,init)=>{const response=await(deps.fetch??globalThis.fetch)(url,init);httpStatus=response.status;return response;},
  beforeDispatch:()=>state.emit('dispatched'),
  onResponse:()=>state.emit(httpStatus!==undefined&&httpStatus>=200&&httpStatus<300?'responded':'rejected',httpStatus!==undefined?{httpStatus}:{}),
  onUnknown:()=>state.unknown(),
 });}catch(error){state.unknown();throw sanitize(error);}
}

