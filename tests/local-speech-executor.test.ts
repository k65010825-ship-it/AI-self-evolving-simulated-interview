import {expect,test} from 'bun:test';
import {runLocalAsr,runLocalTts,type LocalSpeechState} from '../apps/agent/src/local/speech-executor.ts';
const secret='synthetic-private-key';
const context=()=>({userId:'local-user',roleId:'java-backend' as const,runId:'run',attemptId:'attempt',deadlineAt:Date.now()+60000});
const asrConfig=()=>({version:1,enabled:true,providerId:'bailian',modelId:'qwen3-asr-flash',endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1',credentialEnv:'INTERVIEW_BAILIAN_ASR_API_KEY',timeoutMs:1000,authorization:{allowLive:true,expiresAt:Date.now()+60000},budget:{maxCalls:1,maxTotalAudioMs:10000,maxCostMicros:100,reserveCostMicrosPerCall:100}});
const ttsConfig={enabled:true,endpoint:'https://cn-beijing.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation',model:'qwen3-tts-flash',voice:'Cherry',credentialEnv:'INTERVIEW_BAILIAN_ASR_API_KEY'};
function wav(){const b=Buffer.alloc(3244);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(3200,40);return b;}
const asrInput=()=>({context:context(),audioId:'audio',wavBytes:wav(),config:asrConfig(),mode:'live' as const});
const ttsInput=()=>({context:context(),text:'当前面试问题',operationId:'tts',config:ttsConfig,mode:'live' as const});
const completion=(text='我使用Java开发项目')=>JSON.stringify({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:text}}],usage:{prompt_tokens:3,completion_tokens:4,total_tokens:7}});
const stream=()=>`data: ${JSON.stringify({output:{audio:{data:Buffer.alloc(480).toString('base64')},finish_reason:'stop'}})}\n\n`;

test('ASR uses existing provider and bridges repeated responded usage checkpoints',async()=>{
 const states:LocalSpeechState[]=[],metadata:unknown[]=[];let calls=0;
 const result=await runLocalAsr(asrInput(),{credential:secret,onState:(s,m)=>{states.push(s);metadata.push(m);},fetch:async(url,init)=>{
  calls++;expect(url).toEndWith('/chat/completions');expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${secret}`);return new Response(completion());
 }});
 expect(calls).toBe(1);expect(states).toEqual(['dispatched','responded','responded']);expect(metadata.at(-1)).toMatchObject({usage:{inputTokens:3,outputTokens:4,totalTokens:7}});
 expect(result.originalText).toBe('我使用Java开发项目');expect(JSON.stringify(result)).not.toContain(secret);
});

test('fixture ASR/TTS require no credential, HTTP or paid state callback',async()=>{
 const deps={get credential():string{throw Error('credential must not be read');},onState:()=>{throw Error('paid callback');},fetch:async()=>{throw Error('HTTP');}};
 const asr=await runLocalAsr({...asrInput(),mode:'offline-fixture'},deps);
 const tts=await runLocalTts({...ttsInput(),mode:'offline-fixture'},deps);
 expect(asr.mode).toBe('offline-fixture');expect(asr.originalText).toContain('合成');expect(tts.providerId).toContain('fixture');expect(Buffer.from(tts.wavBytes).readUInt32LE(24)).toBe(24000);
});

for(const kind of ['asr','tts'] as const){
 const run=(deps:Parameters<typeof runLocalAsr>[1])=>kind==='asr'?runLocalAsr(asrInput(),deps):runLocalTts(ttsInput(),deps);
 test(`${kind} persistence dispatch failure prevents all HTTP and sanitizes error`,async()=>{
  let calls=0;await expect(run({credential:secret,onState:()=>{throw Error(secret);},fetch:async()=>{calls++;return new Response('');}})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');expect(calls).toBe(0);
 });
 test(`${kind} async dispatch hook is rejected before HTTP`,async()=>{
  let calls=0;await expect(run({credential:secret,onState:async()=>{},fetch:async()=>{calls++;return new Response('');}})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');expect(calls).toBe(0);
 });
 test(`${kind} maps HTTP rejection, network failure and parse failure conservatively`,async()=>{
  for(const [fetch,last] of [[async()=>new Response('denied',{status:429}),'rejected'],[async()=>{throw Error(secret);},'unknown'],[async()=>new Response('broken'),'unknown']] as const){
   const states:LocalSpeechState[]=[];let error:unknown;try{await run({credential:secret,onState:s=>{states.push(s);},fetch});}catch(e){error=e;}
   expect(error).toBeDefined();expect(String(error)).not.toContain(secret);expect(states[0]).toBe('dispatched');expect(states.at(-1)).toBe(last);
  }
 });
 test(`${kind} cancelled before dispatch has zero HTTP; cancellation in flight is unknown`,async()=>{
  let calls=0;const controller=new AbortController();controller.abort();
  await expect(run({credential:secret,signal:controller.signal,onState:()=>{},fetch:async()=>{calls++;return new Response('');}})).rejects.toThrow('RUN_CANCELLED');expect(calls).toBe(0);
  const active=new AbortController(),states:LocalSpeechState[]=[];
  await expect(run({credential:secret,signal:active.signal,onState:s=>{states.push(s);},fetch:async()=>{active.abort();throw Error(secret);}})).rejects.toThrow('RUN_CANCELLED');expect(states.at(-1)).toBe('unknown');
 });
}

test('TTS success returns existing adapter WAV and records success only after parse',async()=>{
 const states:LocalSpeechState[]=[];const output=await runLocalTts(ttsInput(),{credential:secret,onState:s=>{states.push(s);},fetch:async()=>new Response(stream())});
 expect(states).toEqual(['dispatched','responded']);expect(output.wavBytes.length).toBe(524);expect(output.characters).toBe(6);
});

test('ASR rejects credential echoed by provider without publishing it',async()=>{
 const states:LocalSpeechState[]=[];await expect(runLocalAsr(asrInput(),{credential:secret,onState:s=>{states.push(s);},fetch:async()=>new Response(completion(secret))})).rejects.toThrow('MODEL_OUTPUT_INVALID');expect(states.at(-1)).toBe('unknown');
});

test('ASR dispatch timeout becomes unknown without implicit retry',async()=>{
 const states:LocalSpeechState[]=[];let calls=0;const input=asrInput();input.config.timeoutMs=10;
 await expect(runLocalAsr(input,{credential:secret,onState:s=>{states.push(s);},fetch:async()=>{calls++;return new Promise<Response>(()=>{});}})).rejects.toThrow('DEADLINE_EXCEEDED');
 expect(calls).toBe(1);expect(states).toEqual(['dispatched','unknown']);
});

test('missing broker credential and expired context prevent HTTP for both adapters',async()=>{
 let calls=0;const deps={onState:()=>{},fetch:async()=>{calls++;return new Response('');}};
 await expect(runLocalAsr(asrInput(),deps)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
 await expect(runLocalTts(ttsInput(),deps)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
 await expect(runLocalTts({...ttsInput(),context:{...context(),deadlineAt:0}}, {...deps,credential:secret})).rejects.toThrow('DEADLINE_EXCEEDED');
 expect(calls).toBe(0);
});

test('response checkpoint persistence failure never returns a successful transcript or audio',async()=>{
 const hook=(s:LocalSpeechState)=>{if(s==='responded')throw Error(secret);};
 await expect(runLocalAsr(asrInput(),{credential:secret,onState:hook,fetch:async()=>new Response(completion())})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
 await expect(runLocalTts(ttsInput(),{credential:secret,onState:hook,fetch:async()=>new Response(stream())})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
});
