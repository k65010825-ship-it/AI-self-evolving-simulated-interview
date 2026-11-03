import type { SpeechProvider } from '../../apps/agent/src/speech/transcribe.ts';
import type { RoleId } from '../../packages/contracts/src/tools.ts';

/** Generated sine/silence PCM and hand-authored transcript. NOT speech recognition. */
export function makeSpeechFixture(roleId:RoleId='java-backend'){
  const text=roleId==='java-backend'?'事务失败需要回滚保证一致':'组件更新需要取消过期请求';
  const buffer=new ArrayBuffer(44+6000*16*2),view=new DataView(buffer),wavBytes=new Uint8Array(buffer);
  const tag=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  tag(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);tag(8,'WAVE');tag(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);tag(36,'data');view.setUint32(40,buffer.byteLength-44,true);
  for(let i=0;i<96000;i++){
    const ms=i/16,active=(ms>=500&&ms<2500)||(ms>=3500&&ms<5500);
    view.setInt16(44+i*2,active?Math.round(Math.sin(2*Math.PI*240*i/16000)*6553):0,true);
  }
  const provider:SpeechProvider={id:'local-manual-asr-fixture',version:'1',mode:'offline-fixture',transcribe:async()=>({text,language:'zh-CN',
    segments:[{startMs:500,endMs:2500,text:text.slice(0,6),confidence:0.9},{startMs:3500,endMs:5500,text:text.slice(6),confidence:0.8}]})};
  const input={transcriptionId:`fixture-transcript-${roleId}`,audioId:`fixture-audio-${roleId}`,wavBytes,
    context:{userId:'fixture-student',roleId,runId:'speech-fixture',attemptId:'attempt-1',deadlineAt:Date.now()+60000}};
  return{text,wavBytes,input,provider};
}
