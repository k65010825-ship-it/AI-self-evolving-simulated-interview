import {test,expect} from 'bun:test';import {synthesizeTts} from '../apps/agent/src/speech/tts.ts';
const event=(v:unknown)=>`data: ${JSON.stringify(v)}\n\n`;
const input=()=>({text:'请介绍你的项目。',operationId:'tts-test',deadlineAt:Date.now()+60000});
const config={enabled:true,endpoint:'https://cn-beijing.maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation',model:'qwen3-tts-flash',voice:'Cherry',credentialEnv:'INTERVIEW_BAILIAN_ASR_API_KEY'};

test('explicit TTS HTTP rejection frees the concurrency slot while retaining the cost hold',async()=>{
 const events:string[]=[];
 await expect(synthesizeTts(input(),config,{readCredential:()=> 'synthetic',beforeDispatch:()=>{events.push('dispatch');},
  onResponse:()=>{events.push('responded');},onUnknown:()=>{events.push('unknown');},
  fetch:async()=>new Response('rate limited',{status:429})})).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
 expect(events).toEqual(['dispatch','responded']);
});

test('Qianwen native streaming uses the literal string null for nonterminal audio chunks',async()=>{
 const r=await synthesizeTts(input(),config,{readCredential:()=> 'synthetic',beforeDispatch:()=>{},fetch:async()=>new Response(
  event({output:{audio:{data:Buffer.alloc(480).toString('base64')},finish_reason:'null'}})+
  event({output:{audio:{data:''},finish_reason:'stop'}}))});
 expect(r.wavBytes.length).toBe(524);
});

test('supplier streaming WAV header is validated and removed before rebuilding final sizes',async()=>{
 const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(0x7fffffbf,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);
 header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(0x7fffff9b,40);
 const stream=()=>event({output:{audio:{data:Buffer.concat([header,Buffer.alloc(480)]).toString('base64')},finish_reason:'null'}})+event({output:{audio:{data:''},finish_reason:'stop'}});
 const deps={readCredential:()=> 'synthetic',beforeDispatch:()=>{},fetch:async()=>new Response(stream())};
 const result=await synthesizeTts(input(),config,deps);expect(result.wavBytes.length).toBe(524);
 expect(Buffer.from(result.wavBytes).readUInt32LE(40)).toBe(480);
 header.writeUInt32LE(44100,24);await expect(synthesizeTts(input(),config,deps)).rejects.toThrow('MODEL_OUTPUT_INVALID');
});
test('TTS calls pinned supplier, returns PCM WAV and records synchronous budget hooks',async()=>{
 const calls:string[]=[];const pcm=new Uint8Array(4800);
 const r=await synthesizeTts(input(),config,{readCredential:()=> 'synthetic',beforeDispatch:()=>{calls.push('admit');},onResponse:()=>{calls.push('responded');},fetch:async(url,init)=>{
  calls.push('http');expect(url).toBe(config.endpoint);expect(init.redirect).toBe('error');const body=JSON.parse(init.body as string);expect(body.input.text).toBe('请介绍你的项目。');
  return new Response(event({output:{audio:{data:Buffer.from(pcm).toString('base64')},finish_reason:null}})+event({output:{audio:{data:'',url:'http://evil.invalid/not-fetched'},finish_reason:'stop'},usage:{characters:8}}));
 }});expect(calls).toEqual(['admit','http','responded']);expect(Buffer.from(r.wavBytes).subarray(0,4).toString()).toBe('RIFF');
 expect(new DataView(r.wavBytes.buffer,r.wavBytes.byteOffset).getUint32(24,true)).toBe(24000);expect(r.wavBytes.length).toBe(4844);
});
test('TTS admission failure, disabled config, malformed stream and timeout never fake audio',async()=>{
 let calls=0,unknown=0;const deps={readCredential:()=> 'synthetic',beforeDispatch:()=>{},onUnknown:()=>{unknown++;},fetch:async()=>{calls++;return new Response(event({output:{audio:{data:'bad base64'},finish_reason:'stop'}}));}};
 await expect(synthesizeTts(input(),{...config,enabled:false},deps)).rejects.toThrow('FORBIDDEN');
 await expect(synthesizeTts(input(),config,{...deps,beforeDispatch:()=>{throw Error('disk');}})).rejects.toThrow();expect(calls).toBe(0);
 await expect(synthesizeTts(input(),config,deps)).rejects.toThrow('MODEL_OUTPUT_INVALID');expect(calls).toBe(1);expect(unknown).toBe(1);
 await expect(synthesizeTts({...input(),deadlineAt:Date.now()+10},config,{...deps,fetch:async()=>new Promise<Response>(()=>{})})).rejects.toThrow('DEADLINE_EXCEEDED');expect(unknown).toBe(2);
});
