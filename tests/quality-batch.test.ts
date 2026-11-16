import {test,expect} from 'bun:test';
import {prepareQualityBatch,readQualityBatch} from '../evals/quality-batch/dataset.ts';
import {executeQualityBatch} from '../evals/quality-batch/runner.ts';
import {qualityFixtureFetch} from '../experiments/quality-batch/fixture.ts';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
test('frozen two-role batch is disabled by default, injects six calls and replays without credentials',async()=>{
 const prepared=await prepareQualityBatch();expect(prepared.config.authorization.enabled).toBe(false);expect((await readQualityBatch(prepared.output)).digest).toBe(prepared.batch.digest);
 const config={...prepared.config,authorization:{enabled:true,operatorApproved:true,expiresAt:Date.now()+600000,maxRuns:6}};let calls=0;
 const r=await executeQualityBatch(prepared.output,config,{readCredential:()=> 'synthetic-only',fetch:async(i,n)=>{calls++;return qualityFixtureFetch(i,n);}});
 expect(calls).toBe(6);expect(r.summary.httpAttempts).toBe(6);expect(r.summary.clarificationsIssued).toBe(2);expect(r.summary.supplementsScored).toBe(2);expect(r.qualityClaimEligible).toBe(false);
 const again=await executeQualityBatch(prepared.output,config,{readCredential:()=>{throw Error('must not read');},fetch:async()=>{throw Error('must not send');}});
 expect(again.summary.httpAttempts).toBe(6);expect(calls).toBe(6);
 expect(r.rows.every(row=>row.diagnosticsCaptured&&row.diagnostics.length>0)).toBe(true);
 expect(again.rows.map(row=>row.diagnostics)).toEqual(r.rows.map(row=>row.diagnostics));
 await expect(executeQualityBatch(prepared.output,{...config,authorization:{...config.authorization,expiresAt:config.authorization.expiresAt+1}},{readCredential:()=>{throw Error();}})).rejects.toThrow('QUALITY_CONFIG_CONFLICT');
},30000);

test('batch persists static rejection diagnostics across replay without raw model text',async()=>{
 const p=await prepareQualityBatch(),config={...p.config,authorization:{enabled:true,operatorApproved:true,expiresAt:Date.now()+600000,maxRuns:6}};let calls=0;
 const result=await executeQualityBatch(p.output,config,{readCredential:()=> 'synthetic-only',fetch:async()=>{calls++;
  return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{role:'assistant',content:'synthetic-secret-output'},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 }});
 expect(calls).toBe(4);expect(result.summary.failedJobs).toBe(4);
 expect(result.rows.every(row=>row.diagnostics.some(d=>d.stage==='json'&&d.reason==='invalid-json'))).toBe(true);
 expect(JSON.stringify(result)).not.toContain('synthetic-secret-output');
 const replay=await executeQualityBatch(p.output,config,{readCredential:()=>{throw Error();},fetch:async()=>{throw Error();}});
 expect(replay.rows.map(row=>row.diagnostics)).toEqual(result.rows.map(row=>row.diagnostics));
},30000);

test('changed frozen answer is rejected before credential access or network dispatch',async()=>{
 const p=await prepareQualityBatch(),path=join(p.output,'batch.json');
 const changed=JSON.parse(await readFile(path,'utf8'));changed.samples[0].wrong+='altered';await writeFile(path,JSON.stringify(changed));
 let credentialReads=0,calls=0;
 await expect(executeQualityBatch(p.output,{...p.config,authorization:{enabled:true,operatorApproved:true,expiresAt:Date.now()+600000,maxRuns:6}},
  {readCredential:()=>{credentialReads++;return 'synthetic';},fetch:async()=>{calls++;throw Error();}})).rejects.toThrow('QUALITY_BATCH_INVALID');
 expect(credentialReads).toBe(0);expect(calls).toBe(0);
});
test('unknown transport consumption stops the batch rather than trying the next role or retrying',async()=>{
 const p=await prepareQualityBatch(),config={...p.config,authorization:{enabled:true,operatorApproved:true,expiresAt:Date.now()+600000,maxRuns:6}};let calls=0;
 const r=await executeQualityBatch(p.output,config,{readCredential:()=> 'synthetic-only',fetch:async()=>{calls++;throw Error('injected transport loss');}});
 expect(calls).toBe(1);expect(r.summary.stoppedForAccounting).toBe(true);expect(r.summary.heldTokens).toBeGreaterThan(0);
},30000);
