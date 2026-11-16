import {test,expect} from 'bun:test';
import {runClarificationLoop} from '../evals/clarification-loop/runner.ts';
import {verifyClarificationLoop,buildLoopReport,projectLoopRow} from '../evals/clarification-loop/report.ts';
import {loopCases} from '../evals/clarification-loop/cases.ts';
import {contentHash} from '../evals/answers/validation.ts';
import {exportClarificationLoop} from '../scripts/clarification-loop.ts';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
test('two-role loop separates pending, terminal, zero-score and unresolved semantic outcomes',async()=>{
 const r=await runClarificationLoop();
 expect(r.rows).toHaveLength(16);expect(r.summary.regressions).toBe(14);expect(r.summary.matched).toBe(14);expect(r.summary.knownLimits).toBe(2);
 expect(r.summary.clarifiedRegressionSessions).toBe(10);expect(r.summary.scoredAfterClarification).toBe(4);expect(r.summary.zeroScoreAfterClarification).toBe(2);
 expect(r.summary.structuralClosureRate).toBe(.4);expect(r.summary.evaluatorCalls).toBe(26);
 expect(r.rows.filter(x=>x.lane==='known-limit').every(x=>x.steps.at(-1)!.status==='scored'&&x.outcome==='requires-semantic-review')).toBe(true);
 expect(r.rows.filter(x=>x.scenario==='cancel-before').every(x=>x.steps.at(-1)!.status==='cancelled'&&x.evaluatorCalls===0)).toBe(true);
 expect(r.qualityClaimEligible).toBe(false);expect(r.liveModelCalls).toBe(0);expect(r.humanReferenceCount).toBe(0);
 expect(JSON.stringify(r)).not.toContain('初值99');expect(JSON.stringify(r)).not.toContain('actualDuration');
 await verifyClarificationLoop(r);
},20000);
test('a new digest cannot hide changed metrics, lane reassignment or fabricated success traces',async()=>{
 const original=await runClarificationLoop();
 for(const change of [(r:typeof original)=>{r.summary.scoredAfterClarification=10;},(r:typeof original)=>{r.rows[0]!.lane='known-limit';},
  (r:typeof original)=>{r.rows.find(x=>x.scenario==='time-before')!.steps[0]!.status='scored';}]){
  const r=structuredClone(original);change(r);const {digest,...body}=r;r.digest=contentHash(body);
  await expect(verifyClarificationLoop(r)).rejects.toThrow('CLARIFICATION_LOOP_INVALID');
 }
},20000);
test('exported JSON and readable handoff are bound and do not claim real user improvement',async()=>{
 const out=await exportClarificationLoop(),raw=JSON.parse(await readFile(join(out.output,'report.json'),'utf8'));
 expect((await verifyClarificationLoop(raw)).digest).toBe(out.digest);
 const md=await readFile(join(out.output,'report.md'),'utf8');expect(md.includes('4/10')).toBe(true);expect(md.includes('语义风险')).toBe(true);
},20000);
test('a consistent failed trace remains verifiable without being relabeled a success',async()=>{
 const r=await runClarificationLoop(),steps=structuredClone(r.rows[0]!.steps);
 steps[1]={status:'abstained',reason:'clarification_limit',template:null,score:null,observations:0,evaluatorCalls:1};
 r.rows[0]=projectLoopRow(loopCases[0]!,steps);const failed=await buildLoopReport(r.rows);
 expect(failed.status).toBe('failed-regressions');expect(failed.summary.matched).toBe(13);
 expect((await verifyClarificationLoop(failed)).digest).toBe(failed.digest);
},20000);
