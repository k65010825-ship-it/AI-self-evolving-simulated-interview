import {AgentStateError} from '../planning/interview-state.ts';
/** Count actual bytes even when Content-Length is forged. Do not leave ignored readers pending. */
export async function readSpeechBody(request:Request,maxBytes:number,timeoutMs=10000){
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^(0|[1-9]\d*)$/.test(length)||Number(length)>maxBytes))throw new AgentStateError('CONTEXT_BUDGET_EXCEEDED');
 if(request.signal.aborted)throw new AgentStateError('RUN_CANCELLED');
 if(!request.body)return new Uint8Array();const reader=request.body.getReader();
 let timer:ReturnType<typeof setTimeout>|undefined,rejectStop!:(error:unknown)=>void;
 const stop=new Promise<never>((_r,reject)=>{rejectStop=reject;});
 const abort=()=>rejectStop(new AgentStateError('RUN_CANCELLED'));
 request.signal.addEventListener('abort',abort,{once:true});
 timer=setTimeout(()=>rejectStop(new AgentStateError('DEADLINE_EXCEEDED')),timeoutMs);
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){if(request.signal.aborted)throw new AgentStateError('RUN_CANCELLED');
   const part=await Promise.race([reader.read(),stop]);if(request.signal.aborted)throw new AgentStateError('RUN_CANCELLED');
   if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw new AgentStateError('CONTEXT_BUDGET_EXCEEDED');chunks.push(new Uint8Array(part.value));
  }return new Uint8Array(Buffer.concat(chunks));
 }finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});}
}
