import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ToolContextSchema, type ToolContext } from '../../../../packages/contracts/src/tools.ts';
import { AsrOutputSchema, SpeechTranscriptSchema, type SpeechTranscript } from '../../../../packages/contracts/src/speech.ts';
import { AgentStateError } from '../planning/interview-state.ts';
import { inspectWav } from './wav.ts';
import { analyzeAudio, describeSpeech } from './audio-features.ts';
const Metadata=z.object({context:ToolContextSchema.extend({userId:z.string().min(1).max(100)}),
  transcriptionId:z.string().min(1).max(100),audioId:z.string().min(1).max(100)}).strict();
const Provider=z.object({id:z.string().min(1).max(100),version:z.string().min(1).max(100),mode:z.enum(['offline-fixture','live-asr'])}).strict();
export interface SpeechProvider {
  id:string;version:string;mode:'offline-fixture'|'live-asr';
  transcribe:(input:{wavBytes:Uint8Array;durationMs:number;sampleRate:16000},signal:AbortSignal)=>Promise<unknown>;
}
export async function transcribeSpeech(input:{context:ToolContext;transcriptionId:string;audioId:string;wavBytes:Uint8Array},
  dependencies:{provider:SpeechProvider;now?:()=>number;timeoutMs?:number;audioOptions?:{rmsThreshold?:number}},signal?:AbortSignal):Promise<SpeechTranscript>{
  const meta=Metadata.safeParse({context:input.context,transcriptionId:input.transcriptionId,audioId:input.audioId});
  const provider=Provider.safeParse({id:dependencies.provider.id,version:dependencies.provider.version,mode:dependencies.provider.mode});
  const timeout=dependencies.timeoutMs??10000,now=dependencies.now??Date.now;
  if(!meta.success||!provider.success||typeof dependencies.provider.transcribe!=='function'||!Number.isInteger(timeout)||timeout<1||timeout>30000)
    throw new AgentStateError('VALIDATION_ERROR');
  const startedAt=now();
  if(!Number.isSafeInteger(startedAt)||startedAt<0)throw new AgentStateError('VALIDATION_ERROR');
  const deadline=Math.min(meta.data.context.deadlineAt,startedAt+timeout),controller=new AbortController();
  let last=startedAt;
  const check=()=>{
    if(signal?.aborted)throw new AgentStateError('RUN_CANCELLED');
    const at=now();if(!Number.isSafeInteger(at)||at<last)throw new AgentStateError('VALIDATION_ERROR');last=at;
    if(controller.signal.aborted||at>=deadline)throw new AgentStateError('DEADLINE_EXCEEDED');return at;
  };
  check();
  // Validate before copying; an oversized input cannot cause unbounded allocation.
  inspectWav(input.wavBytes);
  // Buffer is a Uint8Array subclass, but Buffer.slice() shares memory. Force real copies.
  const bytes=new Uint8Array(input.wavBytes),audio=inspectWav(bytes);
  const features=analyzeAudio(audio,dependencies.audioOptions),sha256=createHash('sha256').update(bytes).digest('hex');
  let timer:ReturnType<typeof setTimeout>|undefined,onAbort:(()=>void)|undefined;
  try{
    const stop=new Promise<never>((_resolve,reject)=>{
      onAbort=()=>{controller.abort();reject(new AgentStateError('RUN_CANCELLED'));};
      signal?.addEventListener('abort',onAbort,{once:true});
      timer=setTimeout(()=>{controller.abort();reject(new AgentStateError('DEADLINE_EXCEEDED'));},Math.max(1,deadline-check()));
    });
    const work=Promise.resolve().then(()=>{check();return dependencies.provider.transcribe({wavBytes:new Uint8Array(bytes),durationMs:audio.durationMs,sampleRate:16000},controller.signal);})
      .catch((error:unknown)=>{check();if(error instanceof AgentStateError)throw error;throw new AgentStateError('DEPENDENCY_UNAVAILABLE');});
    const raw=await Promise.race([work,stop]);const completedAt=check();
    const parsed=AsrOutputSchema.safeParse(raw);if(!parsed.success)throw new AgentStateError('MODEL_OUTPUT_INVALID');
    const output=SpeechTranscriptSchema.safeParse({schemaVersion:1,kind:'uncommitted-speech-transcript',transcriptionId:meta.data.transcriptionId,
      userId:meta.data.context.userId,roleId:meta.data.context.roleId,mode:provider.data.mode,provider:{id:provider.data.id,version:provider.data.version},
      startedAt,completedAt,audio:{audioId:meta.data.audioId,sha256,byteLength:bytes.length,sampleRate:16000,channels:1,bitsPerSample:16,durationMs:audio.durationMs},
      originalText:parsed.data.text,language:parsed.data.language,segments:parsed.data.segments,expression:describeSpeech(parsed.data.text,features)});
    if(!output.success)throw new AgentStateError('MODEL_OUTPUT_INVALID');return output.data;
  }finally{if(timer!==undefined)clearTimeout(timer);if(onAbort)signal?.removeEventListener('abort',onAbort);}
}
