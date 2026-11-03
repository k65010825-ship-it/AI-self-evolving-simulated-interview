import { z } from 'zod';
import { AudioFeaturesSchema, type SpeechExpression } from '../../../../packages/contracts/src/speech.ts';
import { AgentStateError } from '../planning/interview-state.ts';
import type { PcmAudio } from './wav.ts';
const Options=z.object({rmsThreshold:z.number().min(0.001).max(0.5).default(0.015)}).strict();

/** An energy threshold is a measurable proxy, never semantic VAD or a confidence score. */
export function analyzeAudio(audio:PcmAudio,rawOptions:unknown={}) {
  if(!(audio.pcm instanceof Uint8Array)||audio.sampleRate!==16000||!Number.isSafeInteger(audio.sampleCount)||audio.sampleCount<1||
    audio.sampleCount*2!==audio.pcm.length||audio.durationMs!==audio.sampleCount/16||audio.durationMs>120000)
    throw new AgentStateError('VALIDATION_ERROR');
  const parsed=Options.safeParse(rawOptions);if(!parsed.success)throw new AgentStateError('VALIDATION_ERROR');
  const threshold=parsed.data.rmsThreshold,view=new DataView(audio.pcm.buffer,audio.pcm.byteOffset,audio.pcm.byteLength);
  const silent:{startMs:number;endMs:number;durationMs:number}[]=[];
  let activeSamples=0,quietStart:number|undefined;
  for(let start=0;start<audio.sampleCount;start+=320){
    const end=Math.min(start+320,audio.sampleCount);let sum=0;
    for(let i=start;i<end;i++){const x=view.getInt16(i*2,true)/32768;sum+=x*x;}
    if(Math.sqrt(sum/(end-start))>=threshold){
      activeSamples+=end-start;
      if(quietStart!==undefined){silent.push({startMs:quietStart/16,endMs:start/16,durationMs:(start-quietStart)/16});quietStart=undefined;}
    }else quietStart??=start;
  }
  if(quietStart!==undefined)silent.push({startMs:quietStart/16,endMs:audio.durationMs,durationMs:audio.durationMs-quietStart/16});
  return AudioFeaturesSchema.parse({method:'pcm-rms-threshold-v1',frameMs:20,rmsThreshold:threshold,pauseMinMs:300,
    durationMs:audio.durationMs,activeAudioMs:activeSamples/16,
    leadingLowEnergyMs:silent[0]?.startMs===0?silent[0].durationMs:0,
    trailingLowEnergyMs:activeSamples>0&&silent.at(-1)?.endMs===audio.durationMs?silent.at(-1)!.durationMs:0,
    internalPauses:silent.filter(s=>s.startMs>0&&s.endMs<audio.durationMs&&s.durationMs>=300)});
}

export function describeSpeech(text:string,audio:ReturnType<typeof analyzeAudio>):SpeechExpression {
  const unitCount=[...text.matchAll(/\p{Script=Han}|[A-Za-z0-9]+/gu)].length;
  const unsupported=text.replace(/\p{Script=Han}|[A-Za-z0-9]+|[\p{P}\p{Z}\p{S}\s]/gu,'').length>0;
  const enough=audio.durationMs>=3000&&audio.activeAudioMs>=1000&&unitCount>=4;
  const round=(n:number)=>Math.round(n*1000)/1000;
  return{status:enough&&!unsupported?'descriptive':'insufficient_data',textSource:'original_asr',countMethod:'han-char-latin-alphanumeric-run-v1',
    unitCount,unitsPerMinute:enough&&!unsupported?round(unitCount*60000/audio.durationMs):null,
    unitsPerActiveMinute:enough&&!unsupported?round(unitCount*60000/audio.activeAudioMs):null,audio,
    clarity:null,confidence:null,emotion:null,warnings:['rms_activity_is_not_semantic_speech','asr_text_is_not_ground_truth',
      ...(!enough?['insufficient_duration_activity_or_text']:[]),...(unsupported?['unsupported_script_for_rate']:[])]};
}
