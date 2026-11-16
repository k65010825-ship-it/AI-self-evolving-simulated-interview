import {describe,expect,test} from 'bun:test';
import {createHash} from 'node:crypto';
import {createLocalAudioBuffer} from '../apps/agent/src/local/audio-buffer.ts';
import {LocalError} from '../apps/agent/src/local/profile-store.ts';

function wav(sampleRate=16000,pcmLength=64000){
 const b=Buffer.alloc(44+pcmLength);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);
 b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sampleRate,24);b.writeUInt32LE(sampleRate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(pcmLength,40);return b;
}
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
type AudioBuffer=ReturnType<typeof createLocalAudioBuffer>;
function begin(b:AudioBuffer,id:string,bytes=wav(),deadlineAt=60000){b.begin({audioId:id,byteLength:bytes.length,sha256:sha(bytes),deadlineAt});return bytes;}
function upload(b:AudioBuffer,id:string,bytes=wav(),deadlineAt=60000){begin(b,id,bytes,deadlineAt);for(let offset=0,index=0;offset<bytes.length;offset+=32768,index++)b.chunk({audioId:id,index,base64:bytes.subarray(offset,offset+32768).toString('base64')});return b.finish(id);}
function fails(fn:()=>unknown,code:string){try{fn();throw new Error('Expected LocalError');}catch(e){expect(e).toBeInstanceOf(LocalError);expect((e as LocalError).code).toBe(code);}}

describe('local audio memory transport',()=>{
 test('validates complete WAV then permits exactly one worker and keeps ready slots occupied',()=>{
  const b=createLocalAudioBuffer({now:()=>0});const original=wav();expect(upload(b,'a',original)).toEqual({byteLength:64044,durationMs:2000,sampleRate:16000});upload(b,'b');
  fails(()=>begin(b,'c'),'CONTEXT_BUDGET_EXCEEDED');expect(Buffer.from(b.acquire('a'))).toEqual(original);fails(()=>b.acquire('a'),'CONFLICT');b.release('a');begin(b,'c');
 });
 test('accepts identical last block replay but rejects reordering and different contents',()=>{
  const b=createLocalAudioBuffer({now:()=>0});const bytes=begin(b,'a');const first=bytes.subarray(0,32768).toString('base64');
  fails(()=>b.chunk({audioId:'a',index:1,base64:first}),'CONFLICT');expect(b.chunk({audioId:'a',index:0,base64:first})).toEqual({nextIndex:1});expect(b.chunk({audioId:'a',index:0,base64:first})).toEqual({nextIndex:1});
  fails(()=>b.chunk({audioId:'a',index:0,base64:Buffer.alloc(32768,1).toString('base64')}),'CONFLICT');
  const last=bytes.subarray(32768).toString('base64');b.chunk({audioId:'a',index:1,base64:last});b.finish('a');expect(b.chunk({audioId:'a',index:1,base64:last})).toEqual({nextIndex:2});expect(b.finish('a').durationMs).toBe(2000);
 });
 test('rejects noncanonical base64, oversized and short nonterminal blocks before decoding',()=>{
  const b=createLocalAudioBuffer({now:()=>0});begin(b,'a');for(const base64 of ['AA','AB==','AA==\n','-_==','A'.repeat(43696),Buffer.alloc(4).toString('base64')])fails(()=>b.chunk({audioId:'a',index:0,base64}),'VALIDATION_ERROR');
 });
 test('checks declared length, sha256, WAV format and actual duration',()=>{
  const b=createLocalAudioBuffer({now:()=>0});fails(()=>b.begin({audioId:'a',byteLength:4194305,sha256:'a'.repeat(64),deadlineAt:1}),'VALIDATION_ERROR');
  fails(()=>b.begin({audioId:'a',byteLength:44,sha256:'bad',deadlineAt:1}),'VALIDATION_ERROR');
  begin(b,'a');fails(()=>b.finish('a'),'VALIDATION_ERROR');b.cancel('a');
  const wrong=wav();b.begin({audioId:'a',byteLength:wrong.length,sha256:'0'.repeat(64),deadlineAt:10});for(let o=0,i=0;o<wrong.length;o+=32768,i++)b.chunk({audioId:'a',index:i,base64:wrong.subarray(o,o+32768).toString('base64')});fails(()=>b.finish('a'),'VALIDATION_ERROR');b.cancel('a');
  fails(()=>upload(b,'a',wav(24000)),'VALIDATION_ERROR');b.cancel('a');fails(()=>upload(b,'a',wav(16000,3840002)),'CONTEXT_BUDGET_EXCEEDED');
 });
 test('cancel and expiry retain worker capacity until worker finally releases',()=>{
  let now=0;const b=createLocalAudioBuffer({now:()=>now});upload(b,'a',wav(),10);upload(b,'b',wav(),10);b.acquire('a');b.acquire('b');b.cancel('a');now=10;
  fails(()=>begin(b,'c',wav(),100),'CONTEXT_BUDGET_EXCEEDED');fails(()=>b.acquire('a'),'AUDIO_EXPIRED');b.release('a');begin(b,'c',wav(),100);fails(()=>begin(b,'d',wav(),100),'CONTEXT_BUDGET_EXCEEDED');b.release('b');begin(b,'d',wav(),100);
 });
 test('bounds upload lifetime and clears unpinned data on expiry, close and new instance',()=>{
  let now=0;const b=createLocalAudioBuffer({now:()=>now});fails(()=>begin(b,'a',wav(),60001),'VALIDATION_ERROR');upload(b,'a',wav(),10);now=10;fails(()=>b.acquire('a'),'AUDIO_EXPIRED');upload(b,'b',wav(),20);b.close();b.release('b');fails(()=>b.acquire('b'),'AUDIO_EXPIRED');fails(()=>begin(b,'c',wav(),20),'PROFILE_CLOSED');fails(()=>createLocalAudioBuffer({now:()=>0}).acquire('a'),'AUDIO_EXPIRED');
 });
 test('reserves output capacity before synthesis and reads bounded aligned 24k WAV chunks',()=>{
  const b=createLocalAudioBuffer({now:()=>0});b.reserveOutput('a');b.reserveOutput('b');fails(()=>b.reserveOutput('c'),'CONTEXT_BUDGET_EXCEEDED');fails(()=>b.readOutput({jobId:'a',offset:0}),'AUDIO_EXPIRED');
  const bytes=wav(24000);expect(b.putOutput('a',bytes)).toEqual({byteLength:64044,mimeType:'audio/wav',sampleRate:24000});bytes.fill(0);
  const first=b.readOutput({jobId:'a',offset:0});expect(first.nextOffset).toBe(32768);expect(first.eof).toBe(false);expect(Buffer.from(first.base64,'base64').subarray(0,4).toString()).toBe('RIFF');const last=b.readOutput({jobId:'a',offset:32768});expect(last.nextOffset).toBe(64044);expect(last.eof).toBe(true);expect(last.sampleRate).toBe(24000);
  fails(()=>b.readOutput({jobId:'a',offset:1}),'VALIDATION_ERROR');fails(()=>b.readOutput({jobId:'a',offset:65536}),'VALIDATION_ERROR');b.releaseOutput('a');b.releaseOutput('a');b.reserveOutput('c');fails(()=>b.putOutput('a',wav(24000)),'AUDIO_EXPIRED');
 });
 test('expires outputs sixty seconds after completion and rejects invalid or oversized WAV output',()=>{
  let now=0;const b=createLocalAudioBuffer({now:()=>now});b.reserveOutput('a');now=10000;b.putOutput('a',wav(24000));now=69999;expect(b.readOutput({jobId:'a',offset:0}).mimeType).toBe('audio/wav');now=70000;fails(()=>b.readOutput({jobId:'a',offset:0}),'AUDIO_EXPIRED');
  b.reserveOutput('b');fails(()=>b.putOutput('b',wav()),'VALIDATION_ERROR');fails(()=>b.putOutput('b',Buffer.alloc(8388609)),'CONTEXT_BUDGET_EXCEEDED');b.releaseOutput('b');b.reserveOutput('c');b.close();fails(()=>b.putOutput('c',wav(24000)),'AUDIO_EXPIRED');
 });
});
