import {expect,test} from 'bun:test';
import {meterSseBody} from '../apps/agent/src/model-access/usage-meter.ts';
async function read(text:string,fragment=1){const bytes=new TextEncoder().encode(text);const m=meterSseBody(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=fragment)c.enqueue(bytes.subarray(i,i+fragment));c.close();}}));await new Response(m.stream).text();return m;}
const chunk=(text:string,finish:string|null=null)=>'data: '+JSON.stringify({choices:[{index:0,delta:{content:text},finish_reason:finish}]})+'\r\n\r\n';
const usage='data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\r\n\r\n';
const end='data: [DONE]\r\n\r\n';
test('terminal CR dispatches DONE before its optional LF when the SDK stops reading at the event',async()=>{
 const raw=chunk('x','stop')+usage+end,bytes=new TextEncoder().encode(raw.slice(0,-1));
 const m=meterSseBody(new ReadableStream({start(c){c.enqueue(bytes);}})),reader=m.stream.getReader();
 try{await reader.read();expect(m.completion('x').doneSeen).toBe(true);expect(m.usage()?.outputTokens).toBe(5);}finally{await reader.cancel();}
});
test('wire content matches SDK text across UTF8 byte, CRLF and surrogate delta boundaries without persisting it',async()=>{
 const text='私密😀尾部',m=await read(chunk('私密\ud83d')+chunk('\ude00尾部','stop')+usage+end);
 expect(m.completion(text)).toEqual({doneSeen:true,finish:'stop',framing:'valid',textMatch:'matched'});
 expect(m.completion(text+'x').textMatch).toBe('mismatched');expect(JSON.stringify(m.completion(text))).not.toContain('私密');expect(m.usage()?.outputTokens).toBe(5);
});
test('normal upstream stop can preserve malformed JSON exactly; missing terminal marker cannot certify completion',async()=>{
 const text='{"private":"open',m=await read(chunk(text,'stop')+usage+end);
 expect(m.completion(text)).toMatchObject({finish:'stop',textMatch:'matched',doneSeen:true});
 const eof=await read(chunk(text,'stop')+usage);expect(eof.completion(text)).toMatchObject({doneSeen:false,textMatch:'unavailable'});expect(eof.usage()).toBeUndefined();
});
test('finish causes and contradictory framing are categories, not raw provider strings or parser errors',async()=>{
 const missing=await read(chunk('x')+usage+end);expect(missing.completion('x').finish).toBe('missing');
 const length=await read(chunk('x','length')+usage+end);expect(length.completion('x').finish).toBe('length');
 const conflict=await read(chunk('x','stop')+chunk('','length')+usage+end);expect(conflict.completion('x').finish).toBe('conflicting');
 const other=await read(chunk('x','private-upstream-reason')+usage+end);expect(other.completion('x').finish).toBe('other');expect(JSON.stringify(other.completion('x'))).not.toContain('private');
 const bad=await read(chunk('x','stop')+usage+end+chunk('tail'));expect(bad.completion('x')).toMatchObject({framing:'invalid',textMatch:'unavailable'});expect(bad.usage()).toBeUndefined();
});
