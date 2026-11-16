import {PilotError} from './error.ts';
export async function readApiBody(request:Request,max:number){
 if(request.signal.aborted)throw new PilotError('RUN_CANCELLED');if(!request.body)return new Uint8Array();
 const reader=request.body.getReader();let rejectStop!:(e:unknown)=>void,size=0;const chunks:Uint8Array[]=[];
 const stop=new Promise<never>((_r,reject)=>{rejectStop=reject;});const abort=()=>rejectStop(new PilotError('RUN_CANCELLED'));
 request.signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>rejectStop(new PilotError('DEADLINE_EXCEEDED')),10000);
 try{for(;;){const part=await Promise.race([reader.read(),stop]);if(request.signal.aborted)throw new PilotError('RUN_CANCELLED');if(part.done)break;
   size+=part.value.byteLength;if(size>max)throw new PilotError('CONTEXT_BUDGET_EXCEEDED');chunks.push(new Uint8Array(part.value));}return new Uint8Array(Buffer.concat(chunks));
 }finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});}
}
export async function readApiJson(request:Request){
 if((request.headers.get('content-type')??'').split(';')[0]?.trim().toLowerCase()!=='application/json')throw new PilotError('VALIDATION_ERROR');
 try{return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(await readApiBody(request,32768))) as unknown;}
 catch(e){if(e instanceof PilotError)throw e;throw new PilotError('VALIDATION_ERROR');}
}
