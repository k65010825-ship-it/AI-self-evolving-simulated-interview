import { test, expect } from 'bun:test';
import { makeSpeechFixture } from '../experiments/speech/fixture.ts';
import { inspectWav } from '../apps/agent/src/speech/wav.ts';
import { analyzeAudio } from '../apps/agent/src/speech/audio-features.ts';
import { transcribeSpeech } from '../apps/agent/src/speech/transcribe.ts';
import { confirmSpeechAnswer } from '../apps/agent/src/speech/confirm.ts';
import { describeSpeech } from '../apps/agent/src/speech/audio-features.ts';
import { createHash } from 'node:crypto';

test('known PCM timing yields activity and internal pause candidates, excluding edge silence', () => {
  const wav = inspectWav(makeSpeechFixture().wavBytes);
  const features = analyzeAudio(wav);
  expect(wav.durationMs).toBe(6000);
  expect(features.activeAudioMs).toBe(4000);
  expect(features.leadingLowEnergyMs).toBe(500);
  expect(features.trailingLowEnergyMs).toBe(500);
  expect(features.internalPauses).toEqual([{ startMs: 2500, endMs: 3500, durationMs: 1000 }]);
});

test('ASR fixture preserves source and immutable confirmation while rates use original speech text', async () => {
  const f=makeSpeechFixture();const result=await transcribeSpeech(f.input,{provider:f.provider});
  expect(result.mode).toBe('offline-fixture');expect(result.audio.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(result.expression.unitCount).toBe(12);expect(result.expression.unitsPerMinute).toBe(120);
  expect(result.expression.clarity).toBeNull();expect(result.expression.confidence).toBeNull();
  const confirmed=confirmSpeechAnswer(result,{transcriptionId:result.transcriptionId,audioSha256:result.audio.sha256,
    userId:f.input.context.userId,roleId:f.input.context.roleId,answerId:'answer',text:'这是学生修改后的内容',confirmedAt:Date.now()});
  expect(confirmed.answer.text).toBe('这是学生修改后的内容');expect(result.originalText).toBe(f.text);
  expect(confirmed.expression.unitsPerMinute).toBe(120);expect(confirmed.warnings).toContain('confirmed_text_differs_from_asr');
});

for(const [name,mutate] of [
  ['wrong RIFF',(b:Uint8Array)=>{b[0]=0;}],
  ['wrong sample rate',(b:Uint8Array)=>new DataView(b.buffer).setUint32(24,48000,true)],
  ['stereo',(b:Uint8Array)=>new DataView(b.buffer).setUint16(22,2,true)],
  ['compressed format',(b:Uint8Array)=>new DataView(b.buffer).setUint16(20,3,true)],
  ['odd PCM length',(b:Uint8Array)=>new DataView(b.buffer).setUint32(40,b.length-45,true)],
  ['truncated chunk',(b:Uint8Array)=>new DataView(b.buffer).setUint32(40,b.length,true)],
] as const){test(`WAV rejects ${name}`,()=>{const b=makeSpeechFixture().wavBytes.slice();mutate(b);expect(()=>inspectWav(b)).toThrow('VALIDATION_ERROR');});}

test('WAV bounds byte allocation, duration and duplicate data while allowing padded unknown chunks',()=>{
 expect(()=>inspectWav(new Uint8Array(4*1024*1024+1))).toThrow('CONTEXT_BUDGET_EXCEEDED');
 const original=makeSpeechFixture().wavBytes;
 const duplicate=new Uint8Array(original.length+10);duplicate.set(original);duplicate.set([100,97,116,97,2,0,0,0,0,0],original.length);
 new DataView(duplicate.buffer).setUint32(4,duplicate.length-8,true);expect(()=>inspectWav(duplicate)).toThrow('VALIDATION_ERROR');
 const unknown=original.slice();unknown.set([74,85,78,75],12);expect(()=>inspectWav(unknown)).toThrow('VALIDATION_ERROR');
 const padded=new Uint8Array(original.length+10);padded.set(original.subarray(0,12));padded.set([74,85,78,75,1,0,0,0,77,0],12);padded.set(original.subarray(12),22);
 new DataView(padded.buffer).setUint32(4,padded.length-8,true);expect(inspectWav(padded).durationMs).toBe(6000);
 const long=new Uint8Array(44+120001*32);long.set(original.subarray(0,44));const view=new DataView(long.buffer);
 view.setUint32(4,long.length-8,true);view.setUint32(40,long.length-44,true);expect(()=>inspectWav(long)).toThrow('CONTEXT_BUDGET_EXCEEDED');
});

test('silence, short clips and unsupported scripts leave rates unassessed',()=>{
 const b=makeSpeechFixture().wavBytes.slice();b.fill(0,44);const silent=analyzeAudio(inspectWav(b));
 expect(silent.activeAudioMs).toBe(0);expect(silent.internalPauses).toEqual([]);
 expect(silent.leadingLowEnergyMs).toBe(6000);expect(silent.trailingLowEnergyMs).toBe(0);
 expect(describeSpeech('有效的转写内容',silent).unitsPerMinute).toBeNull();
 const short=b.slice(0,44+16000);short.fill(0,44);const v=new DataView(short.buffer);v.setUint32(4,short.length-8,true);v.setUint32(40,short.length-44,true);
 expect(describeSpeech('足够长的一段文本',analyzeAudio(inspectWav(short))).status).toBe('insufficient_data');
 const f=analyzeAudio(inspectWav(makeSpeechFixture().wavBytes));
 expect(describeSpeech('Java 并发 retry 3次',f).unitCount).toBe(6);
 expect(describeSpeech('你好こんにちはJava',f).unitsPerMinute).toBeNull();
 expect(describeSpeech('',f).unitsPerActiveMinute).toBeNull();
 expect(()=>analyzeAudio(inspectWav(b),{rmsThreshold:0})).toThrow('VALIDATION_ERROR');
});

test('low-energy subthreshold gap is not a pause, and partial last frame is accounted for',()=>{
 const b=makeSpeechFixture().wavBytes.slice();const v=new DataView(b.buffer);
 // Fill existing interior pause with tone except for 200ms, below the 300ms reporting threshold.
 for(let i=2500*16;i<3500*16;i++)v.setInt16(44+i*2,i<2700*16?0:6000,true);
 expect(analyzeAudio(inspectWav(b)).internalPauses).toEqual([]);
 const short=b.slice(0,44+161*2);new DataView(short.buffer).setUint32(4,short.length-8,true);new DataView(short.buffer).setUint32(40,322,true);
 expect(analyzeAudio(inspectWav(short)).durationMs).toBe(10.0625);
});

test('invalid and overlapping ASR timestamps and unbounded outputs are rejected',async()=>{
 for(const output of [
  {text:'回答',language:'zh-CN',segments:[{startMs:1000,endMs:7000,text:'回答'}]},
  {text:'回答',language:'zh-CN',segments:[{startMs:100,endMs:200,text:'回'},{startMs:150,endMs:300,text:'答'}]},
  {text:'回答',language:'zh-CN',segments:[{startMs:500,endMs:100,text:'回答'}]},
  {text:'x'.repeat(10001),language:'zh-CN',segments:[]},
  {text:'回答',language:'zh-CN',segments:[],confidence:1},
 ]){
  const f=makeSpeechFixture();await expect(transcribeSpeech(f.input,{provider:{...f.provider,transcribe:async()=>output}})).rejects.toThrow('MODEL_OUTPUT_INVALID');
 }
 const f=makeSpeechFixture();const empty=await transcribeSpeech(f.input,{provider:{...f.provider,transcribe:async()=>({text:'',language:'unknown',segments:[]})}});
 expect(empty.expression.status).toBe('insufficient_data');expect(empty.expression.unitsPerMinute).toBeNull();
});

test('source WAV hash and analysis are isolated from provider mutation',async()=>{
 const f=makeSpeechFixture(),hash=createHash('sha256').update(f.wavBytes).digest('hex');
 const original=f.provider.transcribe;
 const result=await transcribeSpeech(f.input,{provider:{...f.provider,transcribe:async(input,signal)=>{
  input.wavBytes.fill(0);f.wavBytes.fill(0);return original(input,signal);
 }}});
 expect(result.audio.sha256).toBe(hash);expect(result.expression.audio.activeAudioMs).toBe(4000);
 expect(result.segments[0]?.confidence).toBe(0.9);expect(result.expression.confidence).toBeNull();
});

test('Node Buffer inputs are real copies, protecting both host and provider from shared slice mutation',async()=>{
 const f=makeSpeechFixture(),host=Buffer.from(f.wavBytes),original=f.provider.transcribe;
 const result=await transcribeSpeech({...f.input,wavBytes:host},{provider:{...f.provider,transcribe:async(input,signal)=>{
  input.wavBytes.fill(0);return original(input,signal);
 }}});
 expect(host[0]).toBe(82);expect(result.expression.audio.activeAudioMs).toBe(4000);
 let receivedFirst=0;const second=Buffer.from(f.wavBytes),hash=createHash('sha256').update(second).digest('hex');
 const work=transcribeSpeech({...f.input,wavBytes:second},{provider:{...f.provider,transcribe:async(input,signal)=>{
  receivedFirst=input.wavBytes[0]!;return original(input,signal);
 }}});
 second.fill(0);const completed=await work;expect(receivedFirst).toBe(82);expect(completed.audio.sha256).toBe(hash);
});

test('speech identity limit is rejected before provider work, not mislabeled as model failure',async()=>{
 const f=makeSpeechFixture();let calls=0;
 await expect(transcribeSpeech({...f.input,context:{...f.input.context,userId:'u'.repeat(101)}},
  {provider:{...f.provider,transcribe:async()=>{calls++;return {};}}})).rejects.toThrow('VALIDATION_ERROR');
 expect(calls).toBe(0);
});

test('provider failure, expiration, pre-cancel and clock rollback do not yield a transcript',async()=>{
 const f=makeSpeechFixture();let calls=0;
 const provider={...f.provider,transcribe:async()=>{calls++;throw new Error('private-provider-secret');}};
 await expect(transcribeSpeech(f.input,{provider})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
 const controller=new AbortController();controller.abort();await expect(transcribeSpeech(f.input,{provider},controller.signal)).rejects.toThrow('RUN_CANCELLED');
 await expect(transcribeSpeech({...f.input,context:{...f.input.context,deadlineAt:1}},{provider})).rejects.toThrow('DEADLINE_EXCEEDED');expect(calls).toBe(1);
 let clock=100;await expect(transcribeSpeech(f.input,{now:()=>clock,provider:{...f.provider,transcribe:async()=>{clock=99;return {};}}})).rejects.toThrow('VALIDATION_ERROR');
});

test('hung provider times out; cancel wins even if provider returns late',async()=>{
 const f=makeSpeechFixture();await expect(transcribeSpeech(f.input,{provider:{...f.provider,transcribe:async()=>new Promise(()=>{})},timeoutMs:5})).rejects.toThrow('DEADLINE_EXCEEDED');
 let finish!:(value:unknown)=>void,entered!:()=>void;const start=new Promise<void>(resolve=>{entered=resolve;});
 const controller=new AbortController(),work=transcribeSpeech(f.input,{provider:{...f.provider,transcribe:async()=>new Promise(resolve=>{finish=resolve;entered();})}},controller.signal);
 await start;controller.abort();finish({text:f.text,language:'zh-CN',segments:[]});await expect(work).rejects.toThrow('RUN_CANCELLED');
});

test('confirmation checks audio identity, user, role and chronology; edited text never overwrites ASR',async()=>{
 const f=makeSpeechFixture(),t=await transcribeSpeech(f.input,{provider:f.provider});
 const c={transcriptionId:t.transcriptionId,audioSha256:t.audio.sha256,userId:t.userId,roleId:t.roleId,answerId:'a',text:'确认回答',confirmedAt:t.completedAt};
 expect(()=>confirmSpeechAnswer(t,{...c,userId:'other'})).toThrow('FORBIDDEN');
 expect(()=>confirmSpeechAnswer(t,{...c,roleId:'web-frontend'})).toThrow('ROLE_FORBIDDEN');
 expect(()=>confirmSpeechAnswer(t,{...c,audioSha256:'a'.repeat(64)})).toThrow('VERSION_CONFLICT');
 expect(()=>confirmSpeechAnswer(t,{...c,confirmedAt:t.completedAt-1})).toThrow('VALIDATION_ERROR');
 const changed=structuredClone(t);changed.expression.unitCount=999;expect(()=>confirmSpeechAnswer(changed,c)).toThrow('VALIDATION_ERROR');
 const confirmed=confirmSpeechAnswer(t,c);confirmed.transcription.originalText='mutated';expect(t.originalText).toBe(f.text);
});
