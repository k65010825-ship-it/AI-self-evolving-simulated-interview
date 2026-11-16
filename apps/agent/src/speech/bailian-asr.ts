import {z} from 'zod';
import {AsrServiceConfigSchema,AsrAccountingSchema,type AsrAccounting} from '../../../../packages/contracts/src/asr-service.ts';
import {ToolContextSchema,type ToolContext} from '../../../../packages/contracts/src/tools.ts';
import {AgentStateError} from '../planning/interview-state.ts';
import {inspectWav} from './wav.ts';
import type {SpeechProvider} from './transcribe.ts';
import {parseOmniTranscript} from './omni-stream.ts';
const Usage=z.object({prompt_tokens:z.number().int().nonnegative().max(10_000_000),completion_tokens:z.number().int().nonnegative().max(10_000_000),total_tokens:z.number().int().nonnegative().max(20_000_000)})
 .refine(u=>u.prompt_tokens+u.completion_tokens===u.total_tokens);
const Completion=z.object({choices:z.array(z.object({index:z.literal(0),finish_reason:z.literal('stop'),
 message:z.object({role:z.literal('assistant'),content:z.string().max(10000),tool_calls:z.array(z.unknown()).max(0).optional(),refusal:z.null().optional()})})).length(1)});
export function preflightAsr(raw:unknown){
 const p=AsrServiceConfigSchema.safeParse(raw);
 return {configValid:p.success,networkAccess:'disabled' as const,credentialInspection:'not-performed' as const,
  issues:p.success?[]:['ASR_CONFIG_INVALID']};
}
export interface AsrDependencies{
 context:ToolContext;readCredential:(name:string)=>string|undefined;fetch?:(url:string,init:RequestInit)=>Promise<Response>;now?:()=>number;
 /** Critical synchronous hook; throwing prevents dispatch/publication. No audio/text/key in this record. */
 onCheckpoint?:(snapshot:AsrAccounting)=>void;
}
/** One host-scoped provider; conservative holds are never silently released, even on HTTP rejection. */
export function createBailianAsrProvider(raw:unknown,deps:AsrDependencies):SpeechProvider&{accounting:()=>AsrAccounting}{
 const parsed=AsrServiceConfigSchema.safeParse(raw),ctx=ToolContextSchema.safeParse(deps.context);
 if(!parsed.success||!ctx.success)throw new AgentStateError('VALIDATION_ERROR');
 const config=parsed.data,context=ctx.data,now=deps.now??Date.now,fetcher=deps.fetch??globalThis.fetch;
 let blocked=false,last=-1,active=false;
 const entries:AsrAccounting['entries']=[];
 const accounting=()=>AsrAccountingSchema.parse({version:1,context,accounting:'in-memory-host-declared-cost-holds-not-vendor-billing',vendorBillingVerified:false,
  blocked,callsConsumed:entries.length,audioMsConsumed:entries.reduce((n,e)=>n+e.audioMs,0),heldCostMicros:entries.reduce((n,e)=>n+e.reservedCostMicros,0),entries});
 const checkpoint=()=>{try{
  const result:unknown=deps.onCheckpoint?.(accounting());
  if(result&&typeof (result as {then?:unknown}).then==='function'){
   void Promise.resolve(result).catch(()=>{});throw new AgentStateError('DEPENDENCY_UNAVAILABLE');
  }
 }catch{blocked=true;throw new AgentStateError('DEPENDENCY_UNAVAILABLE');}};
 const clock=()=>{const t=now();if(!Number.isSafeInteger(t)||t<0||t<last)throw new AgentStateError('VALIDATION_ERROR');last=t;return t;};
 const omni=config.modelId==='qwen3.8-omni-flash';
 return {id:omni?'qianwen-qwen-omni-asr':'bailian-qwen-asr',version:'openai-compatible-v1',mode:'live-asr',accounting,
  async transcribe(input,signal){
   if(signal.aborted)throw new AgentStateError('RUN_CANCELLED');
   const start=clock();
   if(!config.enabled||!config.authorization.allowLive||start>=config.authorization.expiresAt)throw new AgentStateError('FORBIDDEN');
   const deadline=Math.min(context.deadlineAt,config.authorization.expiresAt,start+config.timeoutMs);
   if(start>=deadline)throw new AgentStateError('DEADLINE_EXCEEDED');
   const audio=inspectWav(input.wavBytes);
   if(input.sampleRate!==16000||input.durationMs!==audio.durationMs)throw new AgentStateError('VALIDATION_ERROR');
   if(blocked||active)throw new AgentStateError('DEPENDENCY_UNAVAILABLE');
   const current=accounting(),b=config.budget;
   if(entries.length>=b.maxCalls||current.audioMsConsumed+audio.durationMs>b.maxTotalAudioMs||current.heldCostMicros+b.reserveCostMicrosPerCall>b.maxCostMicros)
    throw new AgentStateError('TOOL_BUDGET_EXCEEDED');
   let key:string|undefined;
   try{key=deps.readCredential(config.credentialEnv);}catch{throw new AgentStateError('DEPENDENCY_UNAVAILABLE');}
   if(!key||key.length>4096||/[\s\x00-\x1f\x7f]/.test(key))throw new AgentStateError('DEPENDENCY_UNAVAILABLE');
   const controller=new AbortController();
   const check=()=>{if(signal.aborted)throw new AgentStateError('RUN_CANCELLED');if(clock()>=deadline||controller.signal.aborted)throw new AgentStateError('DEADLINE_EXCEEDED');};
   // Encode our copy before dispatch; no model-controlled URL/path or retrieval context is accepted.
   const audioContent={type:'input_audio',input_audio:{data:`data:audio/wav;base64,${Buffer.from(input.wavBytes).toString('base64')}`,...(omni?{format:'wav'}:{})}};
   const body=JSON.stringify({model:config.modelId,messages:[{role:'user',content:omni?[audioContent,
    {type:'text',text:'请逐字转写这段音频中的话语，保留原语言和技术术语。只输出转写原文，不要总结、回答问题、翻译或添加说明；没有可辨认语音时输出空文本。'}]:[audioContent]}],
    ...(omni?{stream:true,stream_options:{include_usage:true},modalities:['text'],reasoning_effort:'none',max_tokens:config.maxOutputTokens}:{stream:false,asr_options:{enable_itn:false}})});
   let rejectStop!:(e:unknown)=>void,timer:ReturnType<typeof setTimeout>|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,
    responseBody:ReadableStream<Uint8Array>|null|undefined;
   const stop=new Promise<never>((_r,reject)=>{rejectStop=reject;});
   const onAbort=()=>{controller.abort();rejectStop(new AgentStateError('RUN_CANCELLED'));};
   let entry:AsrAccounting['entries'][number]|undefined;
   active=true;
   try{
    signal.addEventListener('abort',onAbort,{once:true});
    timer=setTimeout(()=>{controller.abort();rejectStop(new AgentStateError('DEADLINE_EXCEEDED'));},Math.max(1,deadline-clock()));
    check();entry={callId:`asr-${entries.length+1}`,audioMs:audio.durationMs,reservedCostMicros:b.reserveCostMicrosPerCall,status:'dispatched'};entries.push(entry);checkpoint();check();
    const res=await Promise.race([Promise.resolve().then(()=>{check();return fetcher(`${config.endpoint}/chat/completions`,{method:'POST',redirect:'error',signal:controller.signal,
     headers:{'authorization':`Bearer ${key}`,'content-type':'application/json'},body});}).then(response=>{
      responseBody=response.body;
      if(controller.signal.aborted){void responseBody?.cancel().catch(()=>{});check();}return response;
     }),stop]);check();
    entry.httpStatus=res.status;
    if(!res.ok){entry.status='rejected';checkpoint();void res.body?.cancel().catch(()=>{});throw new AgentStateError('DEPENDENCY_UNAVAILABLE');}
    if(!res.body)throw new AgentStateError('MODEL_OUTPUT_INVALID');
    reader=res.body.getReader();const chunks:Uint8Array[]=[];let size=0;
    for(;;){const part=await Promise.race([reader.read(),stop]);check();if(part.done)break;size+=part.value.byteLength;
     if(size>(omni?262144:65536))throw new AgentStateError('MODEL_OUTPUT_INVALID');chunks.push(part.value);}
    if(omni){
     const result=parseOmniTranscript(Buffer.concat(chunks));
     if(result.usage)entry.usage={inputTokens:result.usage.prompt_tokens,outputTokens:result.usage.completion_tokens,totalTokens:result.usage.total_tokens};
     entry.status='responded';checkpoint();check();return{text:result.text,language:'unknown',segments:[]};
    }
    entry.status='responded';checkpoint();
    let json:unknown;try{json=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AgentStateError('MODEL_OUTPUT_INVALID');}
    const usage=Usage.safeParse((json as {usage?:unknown}|null)?.usage);
    if(usage.success){entry.usage={inputTokens:usage.data.prompt_tokens,outputTokens:usage.data.completion_tokens,totalTokens:usage.data.total_tokens};checkpoint();}
    const completion=Completion.safeParse(json);if(!completion.success)throw new AgentStateError('MODEL_OUTPUT_INVALID');check();
    // This endpoint provides text, not trustworthy word alignment or detected language metadata.
    return {text:completion.data.choices[0]!.message.content,language:'unknown',segments:[]};
   }catch(error){
    if(entry?.status==='dispatched'){entry.status='unknown';blocked=true;checkpoint();}
    if(error instanceof AgentStateError)throw error;
    throw new AgentStateError('DEPENDENCY_UNAVAILABLE');
   }finally{active=false;if(timer!==undefined)clearTimeout(timer);signal.removeEventListener('abort',onAbort);controller.abort();
    if(reader)void reader.cancel().catch(()=>{});else void responseBody?.cancel().catch(()=>{});}
  }};
}
/** Platform-neutral public name; legacy export is preserved for existing integrations. */
export const createAsrProvider=createBailianAsrProvider;
