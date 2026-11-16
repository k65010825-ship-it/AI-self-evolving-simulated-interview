import { test,expect } from 'bun:test';
import { runSemanticBenchmark } from '../evals/answers/semantic/runner.ts';
import { verifySemanticReport } from '../evals/answers/semantic/report.ts';
import { loadSemanticDataset,compileSemanticDataset } from '../evals/answers/semantic/dataset.ts';
import { parseSemanticArgs } from '../scripts/semantic-support.ts';
import { contentHash } from '../evals/answers/validation.ts';
test('all-uncertain does not produce a zero unsupported error; metric tampering is rejected even after rehash',async()=>{
 const r=await runSemanticBenchmark({judge:async()=>({verdict:'uncertain'})});
 expect(r.summary.abstained).toBe(8);expect(r.analysis.accuracy).toBe(0);expect(r.analysis.judgmentCoverage).toBe(0);
 expect(r.analysis.unsupportedAcceptanceRate).toBeNull();expect(r.analysis.unsupportedJudgmentCoverage).toBe(0);
 const altered=structuredClone(r);altered.analysis.correct=8;const{digest,...body}=altered;altered.digest=contentHash(body);
 expect(()=>verifySemanticReport(altered)).toThrow('SEMANTIC_REPORT_INVALID');
},30000);
test('pre-cancel, deadlines and invalid judge output preserve all rows and static errors',async()=>{
 let calls=0;const c=new AbortController();c.abort();
 const cancelled=await runSemanticBenchmark({signal:c.signal,judge:async()=>{calls++;return{verdict:'supported'};}});
 expect(calls).toBe(0);expect(cancelled.rows.every(r=>r.status==='cancelled')).toBe(true);
 const timed=await runSemanticBenchmark({timeoutMs:1,judge:async()=>new Promise(()=>{})});
 expect(timed.rows.every(r=>r.status==='timed_out')).toBe(true);expect(timed.summary.failed).toBe(8);
 const invalid=await runSemanticBenchmark({judge:async()=>({verdict:'supported',reference:'private-extra'})});
 expect(invalid.rows.every(r=>r.status==='failed'&&r.error==='MODEL_OUTPUT_INVALID')).toBe(true);
},30000);
test('only development draft claims and bounded citations are allowed; CLI has no arbitrary commands',()=>{
 for(const args of [['--split','validation'],['--split','reserved-final'],['--command','echo'],['--verify','other.json']])expect(()=>parseSemanticArgs(args)).toThrow('SEMANTIC_ARGS_INVALID');
 const raw=loadSemanticDataset();raw.claims[0]!.quotes[0]!.end=100000;expect(()=>compileSemanticDataset(raw)).toThrow('SEMANTIC_DATASET_INVALID');
 expect(()=>compileSemanticDataset({...loadSemanticDataset(),reviewStatus:'reviewed'})).toThrow('SEMANTIC_DATASET_INVALID');
 expect(()=>compileSemanticDataset({...loadSemanticDataset(),split:'validation'})).toThrow('SEMANTIC_DATASET_INVALID');
});
test('mid-run cancellation and late dependency results never become completed verdict rows',async()=>{
 const c=new AbortController();let calls=0;
 const r=await runSemanticBenchmark({signal:c.signal,judge:async()=>{calls++;c.abort();await new Promise(resolve=>setTimeout(resolve,5));return{verdict:'supported'};}});
 expect(calls).toBe(1);expect(r.rows.every(row=>row.status==='cancelled')).toBe(true);
 await new Promise(resolve=>setTimeout(resolve,10));expect(r.summary.completed).toBe(0);
});
