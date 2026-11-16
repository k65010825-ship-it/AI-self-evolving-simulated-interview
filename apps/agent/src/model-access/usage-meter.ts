import { z } from 'zod';
import {createHash} from 'node:crypto';
import type {WireCompletion} from '../../../../packages/contracts/src/wire-completion.ts';
const n=z.number().int().min(0).max(10000000);
const Usage=z.object({prompt_tokens:n,completion_tokens:n,total_tokens:n}).passthrough()
 .refine(u=>u.total_tokens===u.prompt_tokens+u.completion_tokens&&u.total_tokens>0);
/** Bounded SSE inspection independent of SDK defaults. Does not retain answer content. */
export function meterSseBody(body:ReadableStream<Uint8Array>,maxBytes=2*1024*1024){
 const decoder=new TextDecoder('utf-8',{fatal:true});let pending='',data:string[]=[],bytes=0,done=false,invalid=false,skipLf=false;
 let usage:{inputTokens:number;outputTokens:number;complete:true}|undefined;
 const contentHash=createHash('sha256');let contentSeen=false,wireInvalid=false;
 let finish:WireCompletion['finish']='missing';
 const event=()=>{
  if(!data.length)return;const text=data.join('\n');data=[];
  if(text==='[DONE]'){if(done)invalid=true;done=true;return;}if(done){invalid=true;return;}
  let raw:unknown;try{raw=JSON.parse(text);}catch{invalid=true;return;}
  if(raw&&typeof raw==='object'&&'choices'in raw&&Array.isArray(raw.choices))for(const choice of raw.choices){
   if(!choice||typeof choice!=='object'||choice.index!==0)continue;
   const value=choice.delta?.content;
   if(value!==undefined&&value!==null){if(typeof value==='string'){contentSeen=true;contentHash.update(value,'utf16le');}else wireInvalid=true;}
   const reason=choice.finish_reason;
   if(reason!==undefined&&reason!==null){const next:WireCompletion['finish']=reason==='stop'?'stop':reason==='length'?'length':reason==='tool_calls'||reason==='function_call'?'toolUse':'other';
    finish=finish==='missing'?next:finish===next?finish:'conflicting';}
  }
  if(raw&&typeof raw==='object'&&'usage'in raw&&raw.usage!==null&&raw.usage!==undefined){
   const p=Usage.safeParse(raw.usage);if(!p.success){invalid=true;return;}
   const next={inputTokens:p.data.prompt_tokens,outputTokens:p.data.completion_tokens,complete:true as const};
   if(usage&&JSON.stringify(usage)!==JSON.stringify(next))invalid=true;usage=next;
  }
 };
 const line=(text:string)=>{if(!text){event();return;}if(text.startsWith('data:'))data.push(text.slice(5).replace(/^ /,''));};
 const consume=(final=false)=>{
  let start=0;
  if(skipLf&&pending.length){if(pending[0]==='\n')start=1;skipLf=false;}
  for(let i=start;i<pending.length;i++)if(pending[i]==='\r'||pending[i]==='\n'){
   // CR itself ends the line. The SDK may stop on DONE before reading an optional LF.
   line(pending.slice(start,i));if(pending[i]==='\r'){if(pending[i+1]==='\n')i++;else if(i===pending.length-1)skipLf=true;}start=i+1;
  }
  pending=pending.slice(start);if(pending.length+data.reduce((n,s)=>n+s.length,0)>65536)throw Error('MODEL_STREAM_INVALID');
  if(final){if(pending)line(pending);pending='';event();}
 };
 const stream=body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){
  bytes+=chunk.byteLength;if(bytes>maxBytes)throw Error('MODEL_STREAM_INVALID');pending+=decoder.decode(chunk,{stream:true});consume();controller.enqueue(chunk);
 },flush(){pending+=decoder.decode();consume(true);}}));
 return{stream,usage:()=>done&&!invalid?usage:undefined,
  completion:(sdkText?:string):Pick<WireCompletion,'doneSeen'|'finish'|'framing'|'textMatch'>=>({doneSeen:done,finish,framing:invalid||wireInvalid?'invalid':'valid',
   textMatch:!done||invalid||wireInvalid||!contentSeen||sdkText===undefined?'unavailable':contentHash.copy().digest('hex')===createHash('sha256').update(sdkText,'utf16le').digest('hex')?'matched':'mismatched'})};
}
