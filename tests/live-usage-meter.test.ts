import { test,expect } from 'bun:test';
import { meterSseBody } from '../apps/agent/src/model-access/usage-meter.ts';
async function metered(text:string,fragment=1){
 const b=new TextEncoder().encode(text);const source=new ReadableStream<Uint8Array>({start(c){for(let i=0;i<b.length;i+=fragment)c.enqueue(b.subarray(i,i+fragment));c.close();}});
 const m=meterSseBody(source);await new Response(m.stream).text();return m.usage();
}
test('raw SSE usage survives split UTF-8 and CRLF; cache/reasoning subsets are not double counted',async()=>{
 const s='data: {"choices":[{"delta":{"content":"边界😀"}}]}\r\n\r\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":30,"total_tokens":130,"prompt_tokens_details":{"cached_tokens":80},"completion_tokens_details":{"reasoning_tokens":10}}}\r\n\r\ndata: [DONE]\r\n\r\n';
 expect(await metered(s)).toEqual({inputTokens:100,outputTokens:30,complete:true});
});
test('missing terminal marker, partial or inconsistent usage never become zero-cost settlement',async()=>{
 for(const s of ['data: [DONE]\n\n','data: {"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
  'data: {"usage":{"prompt_tokens":100}}\n\ndata: [DONE]\n\n','data: {"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":9}}\n\ndata: [DONE]\n\n'])expect(await metered(s,16)).toBeUndefined();
});
