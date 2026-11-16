import {TtsConfigSchema,TtsInputSchema} from '../../../../packages/contracts/src/tts.ts';
import {AgentStateError} from '../planning/interview-state.ts';
export interface TtsDependencies {readCredential:(name:string)=>string|undefined;fetch?:(url:string,init:RequestInit)=>Promise<Response>;signal?:AbortSignal;
 beforeDispatch:()=>void;onResponse?:()=>void;onUnknown?:()=>void;}
function hook(fn:(()=>void)|undefined){const result:unknown=fn?.();if(result&&typeof(result as {then?:unknown}).then==='function'){void Promise.resolve(result).catch(()=>{});throw new AgentStateError('DEPENDENCY_UNAVAILABLE');}}
export async function synthesizeTts(rawInput:unknown,rawConfig:unknown,deps:TtsDependencies){
 const ip=TtsInputSchema.safeParse(rawInput),cp=TtsConfigSchema.safeParse(rawConfig);if(!ip.success||!cp.success)throw new AgentStateError('VALIDATION_ERROR');
 const input=ip.data,c=cp.data;if(!c.enabled)throw new AgentStateError('FORBIDDEN');const deadline=Math.min(input.deadlineAt,Date.now()+30000),controller=new AbortController();
 const check=()=>{if(deps.signal?.aborted)throw new AgentStateError('RUN_CANCELLED');if(controller.signal.aborted||Date.now()>=deadline)throw new AgentStateError('DEADLINE_EXCEEDED');};check();
 const key=deps.readCredential(c.credentialEnv);if(!key||key.length>4096||/[\s\x00-\x1f\x7f]/.test(key))throw new AgentStateError('DEPENDENCY_UNAVAILABLE');
 let rejectStop!:(e:unknown)=>void,dispatched=false,responded=false,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,responseBody:ReadableStream<Uint8Array>|null|undefined;
 const stop=new Promise<never>((_r,reject)=>{rejectStop=reject;});void stop.catch(()=>{});const abort=()=>{controller.abort();rejectStop(new AgentStateError('RUN_CANCELLED'));};
 deps.signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>{controller.abort();rejectStop(new AgentStateError('DEADLINE_EXCEEDED'));},Math.max(1,deadline-Date.now()));
 try{check();hook(deps.beforeDispatch);dispatched=true;check();
  const request=Promise.resolve().then(()=>{check();return(deps.fetch??globalThis.fetch)(c.endpoint,{method:'POST',redirect:'error',signal:controller.signal,
   headers:{authorization:`Bearer ${key}`,'content-type':'application/json','X-DashScope-SSE':'enable'},body:JSON.stringify({model:c.model,input:{text:input.text,voice:c.voice,language_type:'Auto'}})});}).then(r=>{
    responseBody=r.body;if(controller.signal.aborted){void responseBody?.cancel().catch(()=>{});check();}return r;});
  const response=await Promise.race([request,stop]);check();
  if(!response.ok){hook(deps.onResponse);responded=true;throw new AgentStateError('DEPENDENCY_UNAVAILABLE');}
  if(!response.body)throw new AgentStateError('DEPENDENCY_UNAVAILABLE');
  reader=response.body.getReader();let bytes=0;const chunks:Uint8Array[]=[];
  for(;;){const part=await Promise.race([reader.read(),stop]);check();if(part.done)break;bytes+=part.value.length;if(bytes>12*1024*1024)throw new AgentStateError('MODEL_OUTPUT_INVALID');chunks.push(part.value);}
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw new AgentStateError('MODEL_OUTPUT_INVALID');}
  const lines=text.split(/\r\n|\n|\r/);if(lines.pop()!=='')throw new AgentStateError('MODEL_OUTPUT_INVALID');let fields:string[]=[],finished=false,count=0,total=0;const audio:Buffer[]=[];
  const consume=()=>{if(!fields.length)return;const data=fields.join('\n');fields=[];if(++count>4096||finished)throw new AgentStateError('MODEL_OUTPUT_INVALID');
   let value:any;try{value=JSON.parse(data);}catch{throw new AgentStateError('MODEL_OUTPUT_INVALID');}
   if(value.code||value.error||value.status_code!==undefined&&value.status_code!==200||!value.output?.audio||!['stop','null',null,undefined].includes(value.output.finish_reason))throw new AgentStateError('MODEL_OUTPUT_INVALID');
   const encoded=value.output.audio.data;if(typeof encoded!=='string'||encoded.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))throw new AgentStateError('MODEL_OUTPUT_INVALID');
   const decoded=Buffer.from(encoded,'base64');if(decoded.toString('base64')!==encoded)throw new AgentStateError('MODEL_OUTPUT_INVALID');total+=decoded.length;
   if(total>8*1024*1024-44)throw new AgentStateError('MODEL_OUTPUT_INVALID');if(decoded.length)audio.push(decoded);
   if(value.output.finish_reason==='stop')finished=true;
  };
  for(const line of lines){if(!line){consume();continue;}if(line.startsWith('data:'))fields.push(line.slice(5).replace(/^ /,''));else if(!line.startsWith(':')&&!line.startsWith('id:')&&!line.startsWith('event:'))throw new AgentStateError('MODEL_OUTPUT_INVALID');}
  if(fields.length||!finished||!total||total%2)throw new AgentStateError('MODEL_OUTPUT_INVALID');
  let pcm=Buffer.concat(audio);
  // Native Qianwen streams may prefix PCM with a canonical WAV header whose
  // sentinel lengths describe an open stream. Never embed that header as samples.
  if(pcm.subarray(0,4).toString()==='RIFF'){
   if(pcm.length<44||pcm.subarray(8,16).toString()!=='WAVEfmt '||pcm.readUInt32LE(16)!==16||pcm.readUInt16LE(20)!==1||pcm.readUInt16LE(22)!==1||
    pcm.readUInt32LE(24)!==24000||pcm.readUInt32LE(28)!==48000||pcm.readUInt16LE(32)!==2||pcm.readUInt16LE(34)!==16||pcm.subarray(36,40).toString()!=='data')throw new AgentStateError('MODEL_OUTPUT_INVALID');
   const ri=pcm.readUInt32LE(4),da=pcm.readUInt32LE(40);
   if(!(ri===pcm.length-8&&da===pcm.length-44)&&!(ri===0x7fffffbf&&da===0x7fffff9b))throw new AgentStateError('MODEL_OUTPUT_INVALID');
   pcm=pcm.subarray(44);if(!pcm.length)throw new AgentStateError('MODEL_OUTPUT_INVALID');
  }
  const wav=Buffer.alloc(44+pcm.length);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);
  check();hook(deps.onResponse);responded=true;return{wavBytes:new Uint8Array(wav),characters:[...input.text].length,providerId:'qianwen',modelId:c.model};
 }catch(error){if(dispatched&&!responded)hook(deps.onUnknown);if(error instanceof AgentStateError)throw error;throw new AgentStateError('DEPENDENCY_UNAVAILABLE');}
 finally{clearTimeout(timer);deps.signal?.removeEventListener('abort',abort);controller.abort();if(reader)void reader.cancel().catch(()=>{});else void responseBody?.cancel().catch(()=>{});}
}
