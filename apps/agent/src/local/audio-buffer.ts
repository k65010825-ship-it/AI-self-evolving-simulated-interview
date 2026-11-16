import {createHash} from 'node:crypto';
import {inspectWav} from '../speech/wav.ts';
import {AgentStateError} from '../planning/interview-state.ts';
import {LocalError} from './profile-store.ts';

const CHUNK_SIZE=32768,MAX_INPUT=4*1024*1024,MAX_TOTAL_INPUT=8*1024*1024,MAX_OUTPUT=8*1024*1024,TTL=60000;
const fail=(code:string):never=>{throw new LocalError(code);};
const validId=(id:string)=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
type Input={byteLength:number;sha256:string;deadlineAt:number;bytes:Uint8Array|undefined;received:number;nextIndex:number;lastBase64:string|undefined;ready:boolean;durationMs:number;active:boolean;worker:boolean};
type Output={bytes:Uint8Array|undefined;expiresAt:number|undefined};

/** Per-profile memory only. A worker must release in finally, even after cancel/close. */
export function createLocalAudioBuffer(options:{now?:()=>number}={}){
 const now=options.now??Date.now,inputs=new Map<string,Input>(),outputs=new Map<string,Output>();let closed=false,timer:ReturnType<typeof setTimeout>|undefined;
 const clock=()=>{const at=now();if(!Number.isSafeInteger(at)||at<0)fail('LOCAL_CLOCK_INVALID');return at;};
 function schedule(){
  if(timer)clearTimeout(timer);timer=undefined;if(closed)return;
  let next=Infinity;for(const input of inputs.values())if(input.active)next=Math.min(next,input.deadlineAt);for(const output of outputs.values())if(output.expiresAt!==undefined)next=Math.min(next,output.expiresAt);
  if(next!==Infinity){timer=setTimeout(()=>{timer=undefined;sweep();},Math.max(1,next-clock()));timer.unref();}
 }
 function discard(id:string,input:Input){input.active=false;input.bytes=undefined;input.lastBase64=undefined;if(!input.worker)inputs.delete(id);}
 function sweep(){const at=clock();for(const [id,input]of inputs)if(input.active&&input.deadlineAt<=at)discard(id,input);for(const[id,output]of outputs)if(output.expiresAt!==undefined&&output.expiresAt<=at)outputs.delete(id);schedule();}
 function inputFor(id:string){sweep();const input=inputs.get(id);if(!input?.active)fail('AUDIO_EXPIRED');return input!;}
 function open(){if(closed)fail('PROFILE_CLOSED');sweep();}
 function outputInfo(bytes:Uint8Array){return{byteLength:bytes.length,mimeType:'audio/wav' as const,sampleRate:24000 as const};}
 function validateOutput(bytes:Uint8Array){
  if(!(bytes instanceof Uint8Array))fail('VALIDATION_ERROR');if(bytes.byteLength>MAX_OUTPUT)fail('CONTEXT_BUDGET_EXCEEDED');if(bytes.length<46)fail('VALIDATION_ERROR');
  const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(b.toString('ascii',0,4)!=='RIFF'||b.readUInt32LE(4)!==b.length-8||b.toString('ascii',8,16)!=='WAVEfmt '||b.readUInt32LE(16)!==16||b.readUInt16LE(20)!==1||b.readUInt16LE(22)!==1||b.readUInt32LE(24)!==24000||b.readUInt32LE(28)!==48000||b.readUInt16LE(32)!==2||b.readUInt16LE(34)!==16||b.toString('ascii',36,40)!=='data'||b.readUInt32LE(40)!==b.length-44||(b.length-44)%2)fail('VALIDATION_ERROR');
 }
 return{
  begin(request:{audioId:string;byteLength:number;sha256:string;deadlineAt:number}){
   open();const {audioId,byteLength,sha256,deadlineAt}=request,at=clock();
   if(!validId(audioId)||!Number.isSafeInteger(byteLength)||byteLength<44||byteLength>MAX_INPUT||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)||!Number.isSafeInteger(deadlineAt)||deadlineAt<=at||deadlineAt>at+TTL)fail('VALIDATION_ERROR');
   if(inputs.has(audioId))fail('CONFLICT');let reserved=0;for(const input of inputs.values())reserved+=input.byteLength;
   if(inputs.size>=2||reserved+byteLength>MAX_TOTAL_INPUT)fail('CONTEXT_BUDGET_EXCEEDED');
   inputs.set(audioId,{byteLength,sha256,deadlineAt,bytes:new Uint8Array(byteLength),received:0,nextIndex:0,lastBase64:undefined,ready:false,durationMs:0,active:true,worker:false});schedule();return{chunkSize:CHUNK_SIZE,nextIndex:0};
  },
  chunk(request:{audioId:string;index:number;base64:string}){
   const {audioId,index,base64}=request,input=inputFor(audioId);
   if(!Number.isSafeInteger(index)||index<0||typeof base64!=='string'||base64.length===0||base64.length>4*Math.ceil(CHUNK_SIZE/3)||base64.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))fail('VALIDATION_ERROR');
   if(index===input.nextIndex-1){if(base64===input.lastBase64)return{nextIndex:input.nextIndex};fail('CONFLICT');}
   if(index!==input.nextIndex||input.ready||input.worker)fail('CONFLICT');const decoded=Buffer.from(base64,'base64');
   if(decoded.toString('base64')!==base64||decoded.length!==Math.min(CHUNK_SIZE,input.byteLength-input.received))fail('VALIDATION_ERROR');
   input.bytes!.set(decoded,input.received);input.received+=decoded.length;input.nextIndex++;input.lastBase64=base64;return{nextIndex:input.nextIndex};
  },
  finish(audioId:string){
   const input=inputFor(audioId);if(input.received!==input.byteLength)fail('VALIDATION_ERROR');
   if(!input.ready){if(createHash('sha256').update(input.bytes!).digest('hex')!==input.sha256)fail('VALIDATION_ERROR');try{input.durationMs=inspectWav(input.bytes!).durationMs;}catch(error){if(error instanceof AgentStateError&&error.code==='CONTEXT_BUDGET_EXCEEDED')fail('CONTEXT_BUDGET_EXCEEDED');fail('VALIDATION_ERROR');}input.ready=true;}
   return{byteLength:input.byteLength,durationMs:input.durationMs,sampleRate:16000 as const};
  },
  acquire(audioId:string){const input=inputFor(audioId);if(!input.ready||input.worker)fail('CONFLICT');input.worker=true;return input.bytes!;},
  // Only the owner worker calls release after it has stopped retaining the bytes.
  release(audioId:string){inputs.delete(audioId);schedule();},
  cancel(audioId:string){const input=inputs.get(audioId);if(input)discard(audioId,input);schedule();},
  reserveOutput(jobId:string){open();if(!validId(jobId))fail('VALIDATION_ERROR');if(outputs.has(jobId))fail('CONFLICT');if(outputs.size>=2)fail('CONTEXT_BUDGET_EXCEEDED');outputs.set(jobId,{bytes:undefined,expiresAt:undefined});},
  putOutput(jobId:string,wav:Uint8Array){sweep();const output=outputs.get(jobId);if(!output)fail('AUDIO_EXPIRED');if(output!.bytes)fail('CONFLICT');validateOutput(wav);output!.bytes=new Uint8Array(wav);output!.expiresAt=clock()+TTL;schedule();return outputInfo(output!.bytes);},
  readOutput(request:{jobId:string;offset:number}){
   sweep();const bytes=outputs.get(request.jobId)?.bytes;if(!bytes)fail('AUDIO_EXPIRED');const {offset}=request;
   if(!Number.isSafeInteger(offset)||offset<0||offset%CHUNK_SIZE||offset>=bytes!.length)fail('VALIDATION_ERROR');const nextOffset=Math.min(offset+CHUNK_SIZE,bytes!.length);
   return{base64:Buffer.from(bytes!.subarray(offset,nextOffset)).toString('base64'),nextOffset,eof:nextOffset===bytes!.length,mimeType:'audio/wav' as const,sampleRate:24000 as const};
  },
  releaseOutput(jobId:string){outputs.delete(jobId);schedule();},
  close(){if(closed)return;closed=true;if(timer)clearTimeout(timer);timer=undefined;for(const[id,input]of inputs)discard(id,input);outputs.clear();},
 };
}
export type LocalAudioBuffer=ReturnType<typeof createLocalAudioBuffer>;
