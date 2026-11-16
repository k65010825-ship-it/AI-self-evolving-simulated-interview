import { test,expect } from 'bun:test';
import { loadSemanticDataset,compileSemanticDataset } from '../evals/answers/semantic/dataset.ts';
import { runOfflineSemanticBenchmark,runSemanticBenchmark } from '../evals/answers/semantic/runner.ts';
import { verifySemanticReport } from '../evals/answers/semantic/report.ts';
test('draft claim labels include valid-offset contradictory and same-answer irrelevant citations',()=>{
 const raw=loadSemanticDataset(),d=compileSemanticDataset(raw);
 expect(d.samples).toHaveLength(8);expect(new Set(d.samples.map(s=>s.roleId)).size).toBe(2);
 const grouped=d.samples.filter(s=>s.sourceCaseId.endsWith('-complete'));
 expect(grouped).toHaveLength(4);expect(new Set(grouped.map(s=>s.reference.verdict))).toEqual(new Set(['supported','insufficient']));
 const bad=structuredClone(raw);bad.claims[0]!.caseDigest='0'.repeat(64);
 expect(()=>compileSemanticDataset(bad)).toThrow('SEMANTIC_DATASET_INVALID');
});
test('actual Pi always-supported baseline reports wrong acceptance against draft labels, never quality success',async()=>{
 const requests:unknown[]=[];const r=await runOfflineSemanticBenchmark(request=>requests.push(request));
 expect(r.summary.total).toBe(8);expect(r.summary.completed).toBe(8);expect(r.analysis.correct).toBe(2);
 expect(r.analysis.unsupportedAccepted).toBe(6);expect(r.analysis.unsupportedAcceptanceRate).toBe(1);
 expect(r.humanReferenceCount).toBe(0);expect(r.qualityClaimEligible).toBe(false);expect(r.liveModelCalls).toBe(0);
 for(const request of requests){const text=JSON.stringify(request);expect(text).not.toContain('caseDigest');expect(text).not.toContain('reference');expect(text).not.toContain('variant');}
 expect(verifySemanticReport(r)).toEqual(r);
},30000);
test('failed judgments cannot disappear from the denominator',async()=>{
 const r=await runSemanticBenchmark({judge:async()=>{throw new Error('private-provider');}});
 expect(r.summary.failed).toBe(8);expect(r.analysis.accuracy).toBe(0);expect(r.analysis.unsupportedAcceptanceRate).toBeNull();
 expect(JSON.stringify(r)).not.toContain('private-provider');
});
