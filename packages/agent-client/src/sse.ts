import{clientError}from'./errors.ts';
import{RequestScope,readChunk}from'./transport.ts';
export interface SseFrame{id:string;event:string;data:string;}
/** Byte-delimited lines preserve UTF-8 across arbitrary transport chunks; incomplete EOF frames are discarded. */
export async function* parseSse(response:Response,scope:RequestScope,maxFrameBytes:number,idleMs:number):AsyncGenerator<SseFrame>{
 const reader=response.body?.getReader();if(!reader)throw clientError('PROTOCOL_ERROR');
 const cancel=()=>{void reader.cancel().catch(()=>{});};scope.signal.addEventListener('abort',cancel,{once:true});
 const decoder=new TextDecoder('utf-8',{fatal:true});let line:number[]=[],bytes=0,skipLF=false,id:string|undefined,event:string|undefined,data:string[]=[];
 function consume():SseFrame|undefined{
  let value:string;try{value=decoder.decode(Uint8Array.from(line));}catch{throw clientError('PROTOCOL_ERROR');}line=[];
  if(value===''){
   if(!data.length){if(id!==undefined||event!==undefined)throw clientError('PROTOCOL_ERROR');bytes=0;return;}
   if(id===undefined||event===undefined)throw clientError('PROTOCOL_ERROR');const frame={id,event,data:data.join('\n')};id=undefined;event=undefined;data=[];bytes=0;return frame;
  }
  if(value.startsWith(':'))return;
  const colon=value.indexOf(':'),field=colon<0?value:value.slice(0,colon);let content=colon<0?'':value.slice(colon+1);if(content.startsWith(' '))content=content.slice(1);
  if(field==='data')data.push(content);
  if(field==='id'){if(id!==undefined||content.includes('\0'))throw clientError('PROTOCOL_ERROR');id=content;}
  if(field==='event'){if(event!==undefined)throw clientError('PROTOCOL_ERROR');event=content;}
 }
 try{
  while(true){const chunk=await readChunk(reader,scope,idleMs);if(chunk.done)return;
   for(const byte of chunk.value){scope.check();if(skipLF){skipLF=false;if(byte===10)continue;}
    if(++bytes>maxFrameBytes)throw clientError('PROTOCOL_ERROR');
    if(byte===10||byte===13){if(byte===13)skipLF=true;const frame=consume();if(frame)yield frame;}else line.push(byte);
   }
  }
 }finally{scope.signal.removeEventListener('abort',cancel);cancel();}
}
