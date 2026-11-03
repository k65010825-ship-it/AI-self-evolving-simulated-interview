import { AgentStateError } from '../planning/interview-state.ts';
export interface PcmAudio { sampleRate:16000; sampleCount:number; durationMs:number; pcm:Uint8Array; }

/** Only uncompressed mono PCM16/16kHz WAV. No paths, URLs or decoder processes. */
export function inspectWav(bytes:Uint8Array):PcmAudio {
  if(!(bytes instanceof Uint8Array))throw new AgentStateError('VALIDATION_ERROR');
  if(bytes.byteLength>4*1024*1024)throw new AgentStateError('CONTEXT_BUDGET_EXCEEDED');
  const bad=():never=>{throw new AgentStateError('VALIDATION_ERROR');};
  if(bytes.length<44)bad();
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const tag=(offset:number)=>String.fromCharCode(...bytes.subarray(offset,offset+4));
  if(tag(0)!=='RIFF'||tag(8)!=='WAVE'||view.getUint32(4,true)!==bytes.length-8)bad();
  let offset=12,hasFormat=false,pcm:Uint8Array|undefined;
  while(offset<bytes.length){
    if(offset+8>bytes.length)bad();
    const size=view.getUint32(offset+4,true),start=offset+8,end=start+size,padded=end+(size%2);
    if(end>bytes.length||padded>bytes.length)bad();
    if(tag(offset)==='fmt '){
      if(hasFormat||size!==16)bad();hasFormat=true;
      if(view.getUint16(start,true)!==1||view.getUint16(start+2,true)!==1||view.getUint32(start+4,true)!==16000||
        view.getUint32(start+8,true)!==32000||view.getUint16(start+12,true)!==2||view.getUint16(start+14,true)!==16)bad();
    }else if(tag(offset)==='data'){
      if(pcm||!size||size%2)bad();pcm=bytes.subarray(start,end);
    }
    offset=padded;
  }
  if(!hasFormat||!pcm)bad();
  const sampleCount=pcm!.length/2,durationMs=sampleCount/16;
  if(durationMs>120000)throw new AgentStateError('CONTEXT_BUDGET_EXCEEDED');
  return{sampleRate:16000,sampleCount,durationMs,pcm:pcm!};
}
