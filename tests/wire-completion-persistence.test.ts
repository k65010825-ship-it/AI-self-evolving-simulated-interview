import {expect,test} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {prepareQualityBatch} from '../evals/quality-batch/dataset.ts';
import {executeQualityBatch} from '../evals/quality-batch/runner.ts';
import {qualityFixtureFetch} from '../experiments/quality-batch/fixture.ts';
import {EvaluationDiagnosticSchema} from '../packages/contracts/src/evaluation-diagnostic.ts';
test('wire observations persist with a frozen batch and replay without credential resolution or dispatch',async()=>{
 const p=await prepareQualityBatch(),config={...p.config,authorization:{enabled:true,operatorApproved:true,expiresAt:Date.now()+600000,maxRuns:6}};let calls=0;
 const result=await executeQualityBatch(p.output,config,{readCredential:()=> 'synthetic',fetch:async(i,n)=>{calls++;return qualityFixtureFetch(i,n);}});
 expect(calls).toBe(6);const observations=result.rows.flatMap(r=>r.diagnostics.filter(d=>d.wireCompletion));expect(observations).toHaveLength(6);
 expect(observations.every(d=>d.stage==='transport'&&d.outcome==='observed'&&d.wireCompletion?.textMatch==='matched')).toBe(true);
 expect(await readFile(p.output+'/report.md','utf8')).toContain('"textMatch":"matched"');
 const replay=await executeQualityBatch(p.output,config,{readCredential:()=>{throw Error('must not read');},fetch:async()=>{throw Error('must not dispatch');}});
 expect(replay.rows.map(r=>r.diagnostics)).toEqual(result.rows.map(r=>r.diagnostics));expect(calls).toBe(6);
},30000);
test('wire evidence cannot be presented as schema acceptance or certify incomplete/synthetic text',()=>{
 const base={version:1,stage:'transport',outcome:'observed',reason:'wire-completion-observed',wireCompletion:{doneSeen:true,finish:'stop',framing:'valid',textMatch:'matched',sdkStop:'stop',comparisonScope:'upstream-to-sdk'}};
 expect(EvaluationDiagnosticSchema.safeParse(base).success).toBe(true);
 for(const v of [{...base,stage:'schema',outcome:'accepted'}, {...base,wireCompletion:{...base.wireCompletion,doneSeen:false}}, {...base,wireCompletion:{...base.wireCompletion,comparisonScope:'host-continuation-not-compared'}}])expect(EvaluationDiagnosticSchema.safeParse(v).success).toBe(false);
});
