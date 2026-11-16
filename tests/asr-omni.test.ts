import {test,expect} from 'bun:test';
import {createBailianAsrProvider,preflightAsr} from '../apps/agent/src/speech/bailian-asr.ts';
import {makeSpeechFixture} from '../experiments/speech/fixture.ts';
import {transcribeSpeech} from '../apps/agent/src/speech/transcribe.ts';
import {runAsrAcceptance} from '../scripts/asr-acceptance.ts';
const config=()=>({version:1,enabled:true,providerId:'qianwen',modelId:'qwen3.8-omni-flash',
 endpoint:'https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1',credentialEnv:'INTERVIEW_BAILIAN_ASR_API_KEY',timeoutMs:1000,maxOutputTokens:512,
 authorization:{allowLive:true,expiresAt:Date.now()+60000},budget:{maxCalls:1,maxTotalAudioMs:10000,maxCostMicros:100000,reserveCostMicrosPerCall:100000}});
const event=(value:unknown)=>`data: ${JSON.stringify(value)}\n\n`;
const delta=(content:string,finish:string|null=null)=>({choices:[{index:0,delta:{content},finish_reason:finish}]});
const usage={prompt_tokens:30,completion_tokens:5,total_tokens:35};
const good=()=>event(delta('事务失败'))+event(delta('需要回滚。','stop'))+event({choices:[],usage})+'data: [DONE]\n\n';
function streamed(text:string,step=1){
 const bytes=new TextEncoder().encode(text);let index=0;
 return new Response(new ReadableStream<Uint8Array>({pull(c){if(index>=bytes.length)c.close();else{c.enqueue(bytes.slice(index,index+step));index+=step;}}}),{headers:{'content-type':'text/event-stream'}});
}
test('Omni model and Qianwen Beijing endpoint are explicitly paired, credentials remain dedicated',()=>{
 expect(preflightAsr(config()).configValid).toBe(true);
 for(const override of [{providerId:'bailian'},{modelId:'qwen3-asr-flash'},{endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1'},
  {endpoint:'https://evil.cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1'},{credentialEnv:'INTERVIEW_QIANWEN_API_KEY'}])
  expect(preflightAsr({...config(),...override}).configValid).toBe(false);
});
test('Omni sends fixed transcription-only audio request and joins arbitrarily split UTF8/SSE',async()=>{
 const f=makeSpeechFixture();let calls=0;
 const p=createBailianAsrProvider(config(),{context:f.input.context,readCredential:n=>{expect(n).toBe('INTERVIEW_BAILIAN_ASR_API_KEY');return 'synthetic';},fetch:async(url,init)=>{
  calls++;expect(url).toBe(`${config().endpoint}/chat/completions`);const body=JSON.parse(init.body as string);
  expect(body.model).toBe('qwen3.8-omni-flash');expect(body.modalities).toEqual(['text']);expect(body.reasoning_effort).toBe('none');
  expect(body.stream).toBe(true);expect(body.max_tokens).toBe(512);expect(body.stream_options).toEqual({include_usage:true});expect(body.asr_options).toBeUndefined();
  expect(body.messages).toHaveLength(1);expect(body.messages[0].content[0].input_audio).toEqual({data:`data:audio/wav;base64,${Buffer.from(f.wavBytes).toString('base64')}`,format:'wav'});
  expect(body.messages[0].content[1].text).toContain('逐字');return streamed(good());
 }});
 const t=await transcribeSpeech(f.input,{provider:p});expect(t.originalText).toBe('事务失败需要回滚。');expect(t.segments).toEqual([]);expect(t.language).toBe('unknown');
 expect(t.provider.id).toBe('qianwen-qwen-omni-asr');expect(p.accounting().entries[0]!.usage).toEqual({inputTokens:30,outputTokens:5,totalTokens:35});
 expect(calls).toBe(1);expect(p.accounting().heldCostMicros).toBe(100000);
});
test('Omni rejects incomplete/truncated/tools/refusals/reasoning/extra choices or trailing data without a retry',async()=>{
 const f=makeSpeechFixture();
 const streams=[event(delta('partial')),event(delta('partial','length'))+'data: [DONE]\n\n',
  event({choices:[{index:0,delta:{tool_calls:[{id:'x'}]},finish_reason:'stop'}]})+'data: [DONE]\n\n',
  event({choices:[{index:0,delta:{refusal:'denied'},finish_reason:'stop'}]})+'data: [DONE]\n\n',
  event({choices:[{index:0,delta:{reasoning_content:'private'},finish_reason:'stop'}]})+'data: [DONE]\n\n',
  event({choices:[{index:1,delta:{content:'wrong'},finish_reason:'stop'}]})+'data: [DONE]\n\n',
  good()+event(delta('late')),event({error:{message:'secret'}})+'data: [DONE]\n\n',
  event(delta('x','stop'))+event(delta('second stop','stop'))+'data: [DONE]\n\n'];
 for(const s of streams){let calls=0;const p=createBailianAsrProvider(config(),{context:f.input.context,readCredential:()=> 'synthetic',fetch:async()=>{calls++;return streamed(s,4096);}});
  await expect(transcribeSpeech(f.input,{provider:p})).rejects.toThrow('MODEL_OUTPUT_INVALID');expect(calls).toBe(1);expect(p.accounting().heldCostMicros).toBe(100000);
 }
});
test('Omni stream limits and missing usage never turn into fabricated transcription or zero fee',async()=>{
 const f=makeSpeechFixture();
 for(const s of [event(delta('x'.repeat(10001),'stop'))+'data: [DONE]\n\n','data: '+ 'x'.repeat(270000)]){
  const p=createBailianAsrProvider(config(),{context:f.input.context,readCredential:()=> 'synthetic',fetch:async()=>streamed(s,4096)});
  await expect(transcribeSpeech(f.input,{provider:p})).rejects.toThrow('MODEL_OUTPUT_INVALID');
 }
 const p=createBailianAsrProvider(config(),{context:f.input.context,readCredential:()=> 'synthetic',fetch:async()=>streamed(event(delta('','stop'))+'data: [DONE]\n\n',2000)});
 const t=await transcribeSpeech(f.input,{provider:p});expect(t.originalText).toBe('');expect(p.accounting().entries[0]!.usage).toBeUndefined();
 expect(p.accounting().heldCostMicros).toBe(100000);
});
test('single-call acceptance preserves injected evidence and requires bounded execution settings',async()=>{
 const f=makeSpeechFixture();let calls=0,reads=0;
 const deps={readCredential:()=>{reads++;return 'synthetic';},fetch:async()=>{calls++;return streamed(good(),2048);}};
 for(const overrides of [{enabled:false},{budget:{...config().budget,maxCalls:2}},{budget:{...config().budget,reserveCostMicrosPerCall:1}},{maxOutputTokens:1024}]){
  await expect(runAsrAcceptance({...config(),...overrides},f.wavBytes,deps)).rejects.toThrow();
 }
 expect(calls).toBe(0);expect(reads).toBe(0);
 const r=await runAsrAcceptance(config(),f.wavBytes,deps);
 expect(r).toMatchObject({status:'passed-transport-candidate',networkMode:'injected-http',liveAsrCalls:0,httpAttempts:1,formalCommitted:false,vendorBillingVerified:false});
 expect(r.transcript?.originalText).toBe('事务失败需要回滚。');expect(calls).toBe(1);
});
test('Omni rejects EOF before the final SSE event blank-line delimiter',async()=>{
 const f=makeSpeechFixture();
 for(const suffix of ['data: [DONE]','data: [DONE]\n']){
  const p=createBailianAsrProvider(config(),{context:f.input.context,readCredential:()=> 'synthetic',fetch:async()=>streamed(event(delta('complete','stop'))+suffix,4096)});
  await expect(transcribeSpeech(f.input,{provider:p})).rejects.toThrow('MODEL_OUTPUT_INVALID');
 }
});
test('acceptance failure records dispatched usage hold without leaking provider error or retrying',async()=>{
 const f=makeSpeechFixture();let calls=0;
 const r=await runAsrAcceptance(config(),f.wavBytes,{readCredential:()=> 'synthetic',fetch:async()=>{calls++;throw Error('private key payload');}});
 expect(r.status).toBe('failed');expect(r.httpAttempts).toBe(1);expect(r.accounting.blocked).toBe(true);expect(r.accounting.heldCostMicros).toBe(100000);
 expect(JSON.stringify(r)).not.toContain('private key payload');expect(calls).toBe(1);
});
