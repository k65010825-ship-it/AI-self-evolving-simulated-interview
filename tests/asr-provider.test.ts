import {test,expect} from 'bun:test';
import {createBailianAsrProvider,preflightAsr} from '../apps/agent/src/speech/bailian-asr.ts';
import {makeSpeechFixture} from '../experiments/speech/fixture.ts';
import {transcribeSpeech} from '../apps/agent/src/speech/transcribe.ts';
import {confirmSpeechAnswer} from '../apps/agent/src/speech/confirm.ts';
import {runAsrProviderDemo} from '../scripts/demo-asr-provider.ts';
import {asrPreflightMain} from '../scripts/asr-preflight.ts';
const config=()=>({version:1,enabled:true,providerId:'bailian',modelId:'qwen3-asr-flash',
 endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1',credentialEnv:'INTERVIEW_BAILIAN_ASR_API_KEY',timeoutMs:1000,
 authorization:{allowLive:true,expiresAt:Date.now()+60000},
 budget:{maxCalls:2,maxTotalAudioMs:120000,maxCostMicros:200000,reserveCostMicrosPerCall:100000}});
const response=(text='事务失败需要回滚保证一致',finish='stop')=>Response.json({id:'synthetic-request',model:'qwen3-asr-flash',choices:[{index:0,message:{role:'assistant',content:text},finish_reason:finish}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});
test('ASR preflight checks configuration only and rejects credential/platform confusion',()=>{
 const c=config();expect(preflightAsr(c)).toMatchObject({configValid:true,networkAccess:'disabled',credentialInspection:'not-performed'});
 for(const endpoint of ['https://maas.qianwenaiapi.com/compatible-mode/v1','https://localhost/compatible-mode/v1','https://dashscope.aliyuncs.com/compatible-mode/v1?key=x'])
  expect(preflightAsr({...c,endpoint}).configValid).toBe(false);
 expect(preflightAsr({...c,credentialEnv:'INTERVIEW_QIANWEN_API_KEY'}).configValid).toBe(false);
});
test('both roles use pinned WAV HTTP, preserve original ASR and require confirmation',async()=>{
 for(const role of ['java-backend','web-frontend'] as const){
  const f=makeSpeechFixture(role);let calls=0,reads=0;const checkpoints:string[]=[];
  const p=createBailianAsrProvider(config(),{context:f.input.context,readCredential:name=>{reads++;expect(name).toBe('INTERVIEW_BAILIAN_ASR_API_KEY');return 'synthetic-asr-secret';},
   onCheckpoint:s=>{checkpoints.push(s.entries.at(-1)?.status??'empty');},fetch:async(url,init)=>{
    calls++;expect(String(url)).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(init?.redirect).toBe('error');expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-asr-secret');
    expect(checkpoints.at(-1)).toBe('dispatched');const body=JSON.parse(init?.body as string);
    expect(body).toEqual({model:'qwen3-asr-flash',messages:[{role:'user',content:[{type:'input_audio',input_audio:{data:`data:audio/wav;base64,${Buffer.from(f.wavBytes).toString('base64')}`}}]}],stream:false,asr_options:{enable_itn:false}});
    return response(f.text);
   }});
  expect(reads).toBe(0);const t=await transcribeSpeech(f.input,{provider:p});
  expect(t.originalText).toBe(f.text);expect(t.segments).toEqual([]);expect(t.language).toBe('unknown');expect(t.mode).toBe('live-asr');
  const a=confirmSpeechAnswer(t,{transcriptionId:t.transcriptionId,audioSha256:t.audio.sha256,userId:t.userId,roleId:role,answerId:'confirmed',text:t.originalText+'。',confirmedAt:Date.now()});
  expect(a.warnings).toEqual(['confirmed_text_differs_from_asr']);expect(a.expression.confidence).toBeNull();
  expect(p.accounting()).toMatchObject({heldCostMicros:100000,callsConsumed:1,audioMsConsumed:6000,vendorBillingVerified:false});expect(calls).toBe(1);
 }
});
test('disabled, expired, invalid WAV and exhausted duration never resolve credentials or dispatch',async()=>{
 const f=makeSpeechFixture();let reads=0,calls=0;const deps={context:f.input.context,readCredential:()=>{reads++;return 'synthetic';},fetch:async()=>{calls++;return response();}};
 for(const c of [{...config(),enabled:false},{...config(),authorization:{allowLive:true,expiresAt:0}}]){
  const p=createBailianAsrProvider(c,deps);await expect(p.transcribe({wavBytes:f.wavBytes,durationMs:6000,sampleRate:16000},new AbortController().signal)).rejects.toThrow('FORBIDDEN');
 }
 const p=createBailianAsrProvider({...config(),budget:{...config().budget,maxTotalAudioMs:5000}},deps);
 await expect(p.transcribe({wavBytes:f.wavBytes,durationMs:6000,sampleRate:16000},new AbortController().signal)).rejects.toThrow('TOOL_BUDGET_EXCEEDED');
 await expect(p.transcribe({wavBytes:new Uint8Array(44),durationMs:6000,sampleRate:16000},new AbortController().signal)).rejects.toThrow('VALIDATION_ERROR');
 expect(reads).toBe(0);expect(calls).toBe(0);
});
test('HTTP rejections and malformed/truncated completions retain holds and never auto retry',async()=>{
 const f=makeSpeechFixture();
 for(const r of [new Response('secret raw provider error',{status:429}),response('partial','length'),Response.json({choices:[]}),new Response('x'.repeat(70000))]){
  let calls=0;const p=createBailianAsrProvider(config(),{context:f.input.context,readCredential:()=> 'synthetic',fetch:async()=>{calls++;return r;}});
  await expect(transcribeSpeech(f.input,{provider:p})).rejects.toThrow();expect(calls).toBe(1);
  expect(p.accounting().heldCostMicros).toBe(100000);expect(JSON.stringify(p.accounting())).not.toContain('secret');
 }
});
test('unknown network use blocks next request and checkpoint failure prevents dispatch',async()=>{
 const f=makeSpeechFixture();let calls=0;
 const p=createBailianAsrProvider(config(),{context:f.input.context,readCredential:()=> 'synthetic',fetch:async()=>{calls++;throw Error('private-error');}});
 await expect(transcribeSpeech(f.input,{provider:p})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
 await expect(transcribeSpeech(f.input,{provider:p})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');expect(calls).toBe(1);expect(p.accounting().blocked).toBe(true);
 const q=createBailianAsrProvider(config(),{context:f.input.context,readCredential:()=> 'synthetic',onCheckpoint:()=>{throw Error('disk');},fetch:async()=>{calls++;return response();}});
 await expect(transcribeSpeech(f.input,{provider:q})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');expect(calls).toBe(1);
});
test('abort and deadline reject ignored fetch/read promises and prevent late transcript',async()=>{
 const f=makeSpeechFixture();let entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});const ctl=new AbortController();
 const p=createBailianAsrProvider(config(),{context:f.input.context,readCredential:()=> 'synthetic',fetch:async()=>{entered();return new Promise<Response>(()=>{});}});
 const work=transcribeSpeech(f.input,{provider:p},ctl.signal);await started;ctl.abort();await expect(work).rejects.toThrow('RUN_CANCELLED');
 await new Promise(r=>setTimeout(r,0));expect(p.accounting().blocked).toBe(true);
 const q=createBailianAsrProvider({...config(),timeoutMs:15},{context:f.input.context,readCredential:()=> 'synthetic',fetch:async()=>new Response(new ReadableStream({start(){}}))});
 await expect(transcribeSpeech(f.input,{provider:q})).rejects.toThrow('DEADLINE_EXCEEDED');expect(q.accounting().heldCostMicros).toBe(100000);
});
test('successful calls still consume cost/count budget and snapshots are detached',async()=>{
 const f=makeSpeechFixture();let calls=0;
 const p=createBailianAsrProvider({...config(),budget:{...config().budget,maxCostMicros:100000}},
  {context:f.input.context,readCredential:()=> 'synthetic',fetch:async()=>{calls++;return response();}});
 await transcribeSpeech(f.input,{provider:p});const s=p.accounting();s.entries.length=0;s.context.userId='tampered';
 await expect(transcribeSpeech(f.input,{provider:p})).rejects.toThrow('TOOL_BUDGET_EXCEEDED');
 expect(calls).toBe(1);expect(p.accounting().context.userId).toBe(f.input.context.userId);expect(p.accounting().entries).toHaveLength(1);
});
test('pre-cancellation does not dispatch; concurrent call cannot escape gate',async()=>{
 const f=makeSpeechFixture();let reads=0,entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});
 const ctl=new AbortController(),p=createBailianAsrProvider(config(),{context:f.input.context,readCredential:()=>{reads++;return 'synthetic';},fetch:async()=>{entered();return new Promise<Response>(()=>{});}});
 ctl.abort();await expect(transcribeSpeech(f.input,{provider:p},ctl.signal)).rejects.toThrow('RUN_CANCELLED');expect(reads).toBe(0);
 const runningCtl=new AbortController(),running=transcribeSpeech(f.input,{provider:p},runningCtl.signal);await started;
 await expect(transcribeSpeech(f.input,{provider:p})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');expect(reads).toBe(1);
 runningCtl.abort();await expect(running).rejects.toThrow('RUN_CANCELLED');
});
test('late ignored fetch response is cancelled and asynchronous checkpoint cannot permit dispatch',async()=>{
 const f=makeSpeechFixture();let release!:(r:Response)=>void,entered!:()=>void,cancelled=false,calls=0;
 const started=new Promise<void>(r=>{entered=r;}),ctl=new AbortController();
 const p=createBailianAsrProvider(config(),{context:f.input.context,readCredential:()=> 'synthetic',fetch:async()=>{entered();return new Promise<Response>(r=>{release=r;});}});
 const work=transcribeSpeech(f.input,{provider:p},ctl.signal);await started;ctl.abort();await expect(work).rejects.toThrow('RUN_CANCELLED');
 release(new Response(new ReadableStream({cancel(){cancelled=true;}})));await new Promise(r=>setTimeout(r,0));expect(cancelled).toBe(true);
 const q=createBailianAsrProvider(config(),{context:f.input.context,readCredential:()=> 'synthetic',onCheckpoint:async()=>{},fetch:async()=>{calls++;return response();}});
 await expect(transcribeSpeech(f.input,{provider:q})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');expect(calls).toBe(0);
});
test('abort between fetch resolution and acquiring reader still closes response body',async()=>{
 const f=makeSpeechFixture();
 for(const depth of [4,5]){
  const ctl=new AbortController();let cancelled=false;
  const p=createBailianAsrProvider(config(),{context:f.input.context,readCredential:()=> 'synthetic',fetch:async()=>{
   const schedule=(n:number)=>queueMicrotask(()=>{if(n===1)ctl.abort();else schedule(n-1);});schedule(depth);
   return new Response(new ReadableStream({cancel(){cancelled=true;}}));
  }});
  await expect(transcribeSpeech(f.input,{provider:p},ctl.signal)).rejects.toThrow('RUN_CANCELLED');
  await new Promise(r=>setTimeout(r,0));expect(cancelled).toBe(true);
 }
});
test('schema rejects tool calls and refusal; missing usage does not fabricate zero fees',async()=>{
 const f=makeSpeechFixture();
 for(const message of [{role:'assistant',content:'x',tool_calls:[{id:'x'}]},{role:'assistant',content:'x',refusal:'denied'}]){
  const p=createBailianAsrProvider(config(),{context:f.input.context,readCredential:()=> 'synthetic',fetch:async()=>Response.json({choices:[{index:0,finish_reason:'stop',message}]})});
  await expect(transcribeSpeech(f.input,{provider:p})).rejects.toThrow('MODEL_OUTPUT_INVALID');expect(p.accounting().heldCostMicros).toBe(100000);
 }
 const p=createBailianAsrProvider(config(),{context:f.input.context,readCredential:()=> 'synthetic',fetch:async()=>Response.json({choices:[{index:0,message:{role:'assistant',content:''},finish_reason:'stop'}]})});
 const t=await transcribeSpeech(f.input,{provider:p});expect(t.originalText).toBe('');expect(t.expression.status).toBe('insufficient_data');
 expect(p.accounting().entries[0]!.usage).toBeUndefined();expect(p.accounting().heldCostMicros).toBe(100000);
});
test('offline demos distinguish injected live transport from actual recognition; preflight cannot execute',async()=>{
 for(const role of ['java-backend','web-frontend'] as const){
  expect(await runAsrProviderDemo(role)).toMatchObject({roleId:role,liveAsrCalls:0,liveModelCalls:0,injectedHttpCalls:1,formalCommitted:false});
 }
 await expect(asrPreflightMain(['--execute'])).rejects.toThrow('ASR_ARGUMENTS_INVALID');
});
