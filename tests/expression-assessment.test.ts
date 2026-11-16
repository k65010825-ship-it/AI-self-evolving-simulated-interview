import {expect,test} from 'bun:test';
import {createExpressionAssessor} from '../apps/agent/src/speech/expression-assessment.ts';
import {ExpressionAssessmentSchema} from '../packages/contracts/src/expression-assessment.ts';
import {makeSpeechFixture} from '../experiments/speech/fixture.ts';
const config=()=>({version:1,enabled:true,providerId:'qianwen',modelId:'qwen3.8-omni-flash',endpoint:'https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1',timeoutMs:1000,maxOutputTokens:1500,authorization:{allowLive:true,expiresAt:Date.now()+60000},budget:{maxCalls:2,maxTotalAudioMs:120000,maxCostMicros:200000,reserveCostMicrosPerCall:100000}});
const fixture=()=>{const f=makeSpeechFixture();return {context:f.input.context,wavBytes:f.wavBytes,originalText:f.text};};
const metric=(quote:string)=>({score:2,evidenceIntervals:[{startMs:500,endMs:1800,quote}],observation:'可辨认的句段连续表达，仍需独立人工核验。'});
const modelResult=(text:string)=>({clarity:metric(text),confidentDelivery:metric(text),vocalValence:{score:null,evidenceIntervals:[],observation:'不足以评价。'}});
const sse=(value:unknown)=>new Response(`data: ${JSON.stringify({choices:[{index:0,delta:{content:JSON.stringify(value)},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
test('expression adapter uses pinned Omni audio transport and never promotes model estimates to formal score',async()=>{
 const f=fixture();const events:string[]=[];let calls=0;
 const p=createExpressionAssessor(config(),{context:f.context,voiceKey:'synthetic-voice-key',beforeDispatch:()=>{events.push('dispatch');},onResponse:()=>{events.push('response');},onUnknown:()=>{events.push('unknown');},fetch:async(url,init)=>{
  calls++;expect(url).toBe('https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1/chat/completions');expect(init.redirect).toBe('error');const body=JSON.parse(init.body as string);
  expect(body).toMatchObject({stream:true,modalities:['text'],reasoning_effort:'none',max_tokens:1500});expect(body.messages[0].content[0].input_audio.data).toStartWith('data:audio/wav;base64,');expect(events).toEqual(['dispatch']);return sse(modelResult(f.originalText));
 }});
 const result=await p.assess(f,new AbortController().signal);expect(ExpressionAssessmentSchema.parse(result)).toEqual(result);
 expect(result).toMatchObject({status:'unvalidated-model-estimate',dataStatus:'sufficient_data',usedInFormalScore:false,reliabilityValidated:false,clarity:{score:2},source:{modelId:'qwen3.8-omni-flash'}});
 expect(result.source.audioSha256).toMatch(/^[a-f0-9]{64}$/);expect(events).toEqual(['dispatch','response']);expect(calls).toBe(1);
});
test('silent, short or text-free WAV produces insufficient data without paid dispatch',async()=>{
 const f=fixture();let calls=0;const p=createExpressionAssessor(config(),{context:f.context,voiceKey:'synthetic',fetch:async()=>{calls++;throw Error();}});
 const quiet=f.wavBytes.slice();quiet.fill(0,44);
 const short=f.wavBytes.slice(0,44+32000);const view=new DataView(short.buffer,short.byteOffset,short.byteLength);view.setUint32(4,short.length-8,true);view.setUint32(40,32000,true);
 for(const input of [{...f,wavBytes:quiet},{...f,wavBytes:short},{...f,originalText:''}]){
  const result=await p.assess(input,new AbortController().signal);expect(result.dataStatus).toBe('insufficient_data');expect(result.clarity.score).toBeNull();expect(result.confidentDelivery.score).toBeNull();expect(result.vocalValence.score).toBeNull();
 }expect(calls).toBe(0);
});
test('invented transcript quotes, invalid intervals, excess scores and hidden fields fail validation',async()=>{
 const f=fixture();for(const value of [
 {...modelResult(f.originalText),clarity:metric('不存在的逐字引语')},
 {...modelResult(f.originalText),clarity:{...metric(f.originalText),evidenceIntervals:[{startMs:0,endMs:7000,quote:f.originalText}]}},
 {...modelResult(f.originalText),clarity:{...metric(f.originalText),score:5}},
 {...modelResult(f.originalText),psychologicalConfidence:4},
 ]){const p=createExpressionAssessor(config(),{context:f.context,voiceKey:'synthetic',fetch:async()=>sse(value)});await expect(p.assess(f,new AbortController().signal)).rejects.toThrow('MODEL_OUTPUT_INVALID');}
});
test('pre-cancel, invalid WAV, disabled authorization and budget gates prevent dispatch',async()=>{
 const f=fixture();let calls=0;const deps={context:f.context,voiceKey:'synthetic',fetch:async()=>{calls++;return sse(modelResult(f.originalText));}};
 const ctl=new AbortController();ctl.abort();const p=createExpressionAssessor(config(),deps);
 await expect(p.assess(f,ctl.signal)).rejects.toThrow('RUN_CANCELLED');await expect(p.assess({...f,wavBytes:new Uint8Array(44)},new AbortController().signal)).rejects.toThrow('VALIDATION_ERROR');
 const disabled=createExpressionAssessor({...config(),enabled:false},deps);await expect(disabled.assess(f,new AbortController().signal)).rejects.toThrow('FORBIDDEN');
 const limited=createExpressionAssessor({...config(),budget:{...config().budget,maxTotalAudioMs:1}},deps);await expect(limited.assess(f,new AbortController().signal)).rejects.toThrow('TOOL_BUDGET_EXCEEDED');expect(calls).toBe(0);
});
test('timeout against ignored fetch records unknown use, blocks retry and leaks no provider error',async()=>{
 const f=fixture();let calls=0,unknown=0;const p=createExpressionAssessor({...config(),timeoutMs:10},{context:f.context,voiceKey:'synthetic',onUnknown:()=>{unknown++;},fetch:async()=>{calls++;return new Promise<Response>(()=>{});}});
 await expect(p.assess(f,new AbortController().signal)).rejects.toThrow('DEADLINE_EXCEEDED');await expect(p.assess(f,new AbortController().signal)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');expect(calls).toBe(1);expect(unknown).toBe(1);
});
test('async beforeDispatch fails closed and truncated SSE cannot become a partial assessment',async()=>{
 const f=fixture();let calls=0;const p=createExpressionAssessor(config(),{context:f.context,voiceKey:'synthetic',beforeDispatch:async()=>{},fetch:async()=>{calls++;return sse(modelResult(f.originalText));}});
 await expect(p.assess(f,new AbortController().signal)).rejects.toThrow('DEPENDENCY_UNAVAILABLE');expect(calls).toBe(0);
 const q=createExpressionAssessor(config(),{context:f.context,voiceKey:'synthetic',fetch:async()=>new Response('data: {"choices":[]}\n\n')});await expect(q.assess(f,new AbortController().signal)).rejects.toThrow('MODEL_OUTPUT_INVALID');
});
test('cancelled requests cannot publish late responses and cancel the late response body',async()=>{
 const f=fixture();let release!:(value:Response)=>void,entered!:()=>void,closed=false,unknown=0;const started=new Promise<void>(r=>{entered=r;});const ctl=new AbortController();
 const p=createExpressionAssessor(config(),{context:f.context,voiceKey:'synthetic',onUnknown:()=>{unknown++;},fetch:async()=>{entered();return new Promise<Response>(r=>{release=r;});}});
 const running=p.assess(f,ctl.signal);await started;ctl.abort();await expect(running).rejects.toThrow('RUN_CANCELLED');
 release(new Response(new ReadableStream({cancel(){closed=true;}})));await new Promise(r=>setTimeout(r,0));expect(closed).toBe(true);expect(unknown).toBe(1);
});
test('oversized body and a stalled reader fail closed with unknown-use holds',async()=>{
 const f=fixture();for(const response of [new Response('x'.repeat(262145)),new Response(new ReadableStream({start(){}}))]){
  let unknown=0;const p=createExpressionAssessor({...config(),timeoutMs:20},{context:f.context,voiceKey:'synthetic',onUnknown:()=>{unknown++;},fetch:async()=>response});
  await expect(p.assess(f,new AbortController().signal)).rejects.toThrow();expect(unknown).toBe(1);
 }
});
test('configuration cannot expand model, endpoint, output budget, or enter a reliable/formal label',()=>{
 const f=fixture();for(const change of [{maxOutputTokens:1501},{endpoint:'https://example.com/compatible-mode/v1'},{modelId:'other'},{credentialEnv:'GLOBAL_PERSONAL_KEY'}])expect(()=>createExpressionAssessor({...config(),...change},{context:f.context,voiceKey:'synthetic'})).toThrow('VALIDATION_ERROR');
 const base={...modelResult(f.originalText),version:1,status:'reliable',dataStatus:'sufficient_data',source:{audioSha256:'a'.repeat(64),modelId:'qwen3.8-omni-flash',durationMs:6000},usedInFormalScore:true,reliabilityValidated:true,warnings:[]};expect(ExpressionAssessmentSchema.safeParse(base).success).toBe(false);
});
test('abort inside admission hook never dispatches or leaves an unhandled stop promise',async()=>{
 const f=fixture();const ctl=new AbortController();let calls=0;
 const p=createExpressionAssessor(config(),{context:f.context,voiceKey:'synthetic',beforeDispatch:()=>{ctl.abort();},fetch:async()=>{calls++;return sse(modelResult(f.originalText));}});
 await expect(p.assess(f,ctl.signal)).rejects.toThrow('RUN_CANCELLED');await new Promise(r=>setTimeout(r,0));expect(calls).toBe(0);
});
