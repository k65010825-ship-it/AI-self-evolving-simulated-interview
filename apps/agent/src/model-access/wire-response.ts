/** Bounded bodies are only inspected for typed recovery; raw errors are never exposed. */
export async function contextErrorCode(response:Response,signal:AbortSignal){
 if(!response.body)return false;const reader=response.body.getReader();let size=0,text='';const decoder=new TextDecoder();
 let rejectAbort!:(e:unknown)=>void;const abort=()=>{void reader.cancel().catch(()=>{});rejectAbort(Error('stopped'));};
 const stopped=new Promise<never>((_r,reject)=>{rejectAbort=reject;signal.addEventListener('abort',abort,{once:true});});
 try{
  while(true){if(signal.aborted)throw Error('stopped');const r=await Promise.race([reader.read(),stopped]);if(r.done)break;size+=r.value.byteLength;if(size>8192)return false;text+=decoder.decode(r.value,{stream:true});}
  text+=decoder.decode();const parsed=JSON.parse(text);return ['context_length_exceeded','context_window_exceeded','input_length_exceeded'].includes(parsed?.error?.code);
 }catch{return false;}finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});}
}
export function inspectCompletion(text:string){
 let output='',finish:string|null=null,tools=false,data:string[]=[];
 const event=()=>{if(!data.length)return;const s=data.join('\n');data=[];if(s==='[DONE]')return;
  const chunk=JSON.parse(s);for(const choice of chunk.choices??[]){if(choice.index!==0)continue;const d=choice.delta??{};
   if(d.tool_calls||d.function_call)tools=true;if(typeof d.content==='string')output+=d.content;
   if(choice.finish_reason)finish=choice.finish_reason;}
 };
 for(const line of text.split(/\r\n|\r|\n/)){if(!line)event();else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));}event();
 return{output,finish,tools};
}
export function completionResponse(text:string,usage:{inputTokens:number;outputTokens:number}){
 return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:'stop'}]})+'\n\n'+
 'data: '+JSON.stringify({choices:[],usage:{prompt_tokens:usage.inputTokens,completion_tokens:usage.outputTokens,total_tokens:usage.inputTokens+usage.outputTokens}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
