import {expect,test} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {prepareQualityBatch} from '../evals/quality-batch/dataset.ts';
import {executeQualityBatch} from '../evals/quality-batch/runner.ts';
import {qualityFixtureFetch} from '../experiments/quality-batch/fixture.ts';
test('static conflict fields persist in JSON and Markdown and survive zero-call durable replay',async()=>{
 const p=await prepareQualityBatch(),config={...p.config,authorization:{enabled:true,operatorApproved:true,expiresAt:Date.now()+600000,maxRuns:6}};let calls=0;
 const r=await executeQualityBatch(p.output,config,{readCredential:()=> 'synthetic-only',fetch:async(input,init)=>{
  calls++;const response=await qualityFixtureFetch(input,init),wire=await response.text();
  const changed=wire.split('\n\n').map(frame=>{
   if(!frame.startsWith('data: ')||frame==='data: [DONE]')return frame;const value=JSON.parse(frame.slice(6));
   for(const choice of value.choices??[])if(choice.delta?.content){const out=JSON.parse(choice.delta.content);for(const c of out.criterionScores){if(c.verificationBinding)c.verificationBinding.target={...c.verificationBinding.action};}choice.delta.content=JSON.stringify(out);}
   return 'data: '+JSON.stringify(value);
  }).join('\n\n');return new Response(changed,{headers:{'content-type':'text/event-stream'}});
 }});
 expect(calls).toBe(6);const conflicts=r.rows.flatMap(row=>row.diagnostics.filter(d=>d.bindingConflict));expect(conflicts).toHaveLength(4);
 expect(conflicts.every(d=>d.bindingIssue==='span-overlap'&&d.bindingConflict?.parts.join('/')==='action/target'&&d.bindingConflict.relation==='identical')).toBe(true);
 const md=await readFile(join(p.output,'report.md'),'utf8');expect(md).toContain('"parts":["action","target"]');
 const again=await executeQualityBatch(p.output,config,{readCredential:()=>{throw Error('must not read');},fetch:async()=>{throw Error('must not send');}});
 expect(again.rows.map(row=>row.diagnostics)).toEqual(r.rows.map(row=>row.diagnostics));expect(calls).toBe(6);
},30000);
