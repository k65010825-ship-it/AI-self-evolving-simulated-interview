import {test,expect} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {prepareQualityBatch} from '../evals/quality-batch/dataset.ts';
import {executeQualityBatch} from '../evals/quality-batch/runner.ts';
import {qualityFixtureFetch} from '../experiments/quality-batch/fixture.ts';

test('explicit local fence repair in the frozen batch uses only six HTTP attempts and replays without credentials',async()=>{
 const p=await prepareQualityBatch(),config={...p.config,outputRepair:'json-fence-only',authorization:{enabled:true,operatorApproved:true,expiresAt:Date.now()+600000,maxRuns:6}};let calls=0;
 const r=await executeQualityBatch(p.output,config,{readCredential:()=> 'synthetic-only',fetch:async(input,init)=>{
  calls++;const response=await qualityFixtureFetch(input,init),raw=await response.text();
  const body=raw.split('\n\n').map(frame=>{if(!frame.startsWith('data: ')||frame==='data: [DONE]')return frame;const value=JSON.parse(frame.slice(6));
   for(const choice of value.choices??[])if(typeof choice.delta?.content==='string')choice.delta.content='```json\n'+choice.delta.content+'\n```';return 'data: '+JSON.stringify(value);}).join('\n\n');
  return new Response(body,{headers:{'content-type':'text/event-stream'}});
 }});
 expect(calls).toBe(6);expect(r.summary.failedJobs).toBe(0);expect(r.summary.supplementsScored).toBe(2);
 expect(r.rows.every(row=>row.diagnostics.some(d=>d.reason==='json-fence-unwrapped'))).toBe(true);
 const replay=await executeQualityBatch(p.output,config,{readCredential:()=>{throw Error();},fetch:async()=>{throw Error();}});expect(replay.summary.httpAttempts).toBe(6);expect(calls).toBe(6);
},30000);

test('allowing local fence repair does not authorize model regeneration in the frozen batch',async()=>{
 const p=await prepareQualityBatch();let reads=0,calls=0;
 const c={...p.config,outputRepair:'json-fence-only',recovery:{...p.config.recovery,maxModelRepairs:1},authorization:{enabled:true,operatorApproved:true,expiresAt:Date.now()+600000,maxRuns:6}};
 await expect(executeQualityBatch(p.output,c,{readCredential:()=>{reads++;return 'synthetic';},fetch:async()=>{calls++;throw Error();}})).rejects.toThrow('QUALITY_CONFIG_INVALID');
 expect(reads).toBe(0);expect(calls).toBe(0);
});

test('syntax failures settle injected usage and retain sanitized JSON detail in Markdown and durable replay',async()=>{
 const p=await prepareQualityBatch(),config={...p.config,authorization:{enabled:true,operatorApproved:true,expiresAt:Date.now()+600000,maxRuns:6}};let calls=0;
 const r=await executeQualityBatch(p.output,config,{readCredential:()=> 'synthetic-only',fetch:async()=>{calls++;return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:'{"private-json":'},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}});
 expect(calls).toBe(4);expect(r.summary.usedTokens).toBe(800);expect(r.summary.heldTokens).toBe(0);
 expect(r.rows.every(row=>row.diagnostics.some(d=>d.jsonIssue==='unclosed-structure'))).toBe(true);
 expect(r.rows.every(row=>row.diagnostics.some(d=>d.jsonShape?.containers==='open'&&d.jsonShape.stringState==='closed'))).toBe(true);
 const markdown=await readFile(join(p.output,'report.md'),'utf8');expect(markdown).toContain('unclosed-structure');expect(markdown).not.toContain('private-json');
 expect(markdown).toContain('"openDepth":"one"');
 const replay=await executeQualityBatch(p.output,config,{readCredential:()=>{throw Error();},fetch:async()=>{throw Error();}});expect(replay.rows.map(row=>row.diagnostics)).toEqual(r.rows.map(row=>row.diagnostics));expect(calls).toBe(4);
},30000);
