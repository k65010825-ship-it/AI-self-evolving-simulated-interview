import {test,expect} from 'bun:test';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {join} from 'node:path';
import {contentHash} from '../evals/answers/validation.ts';
import {prepareScoringQualityBatch,scoringQualityAuthorization,readScoringQualityBatch} from '../evals/scoring-quality/batch.ts';
import {executeScoringQuality,inspectScoringQuality} from '../evals/scoring-quality/runner.ts';
import {scoringQualityFixture} from '../experiments/scoring-quality/fixture.ts';
const sources=async()=>[{path:'package.json',sha256:'a'.repeat(64)}];
const prepare=()=>prepareScoringQualityBatch({outputRoot:'.cache/scoring-quality-tests',sources});
const auth=(b:any)=>scoringQualityAuthorization(b,'injected-test-only',Date.now()+600000);

test('JSON mode HTTP rejection stops batch without erasing unrun cases or retrying',async()=>{
 const p=await prepare();let calls=0;
 const r=await executeScoringQuality(p.output,auth(p.batch),{sources,readCredential:()=> 'synthetic',fetch:async()=>{calls++;return new Response('private',{status:400});}},{execute:true,mode:'injected-test-only'});
 expect(calls).toBe(1);expect(r.report.rows).toHaveLength(8);expect(r.report.rows.filter(x=>x.status==='not_run')).toHaveLength(7);
 expect(r.report.runError).toBe('SCORING_QUALITY_RUNTIME_FAILED');expect(r.report.stoppedForAccounting).toBe(false);
 expect(r.report.accounting[0]!.entries[0]!.status).toBe('rejected');expect((await inspectScoringQuality(p.output)).report.digest).toBe(r.report.digest);
});
test('Pi scoring rehearsal distinguishes eight outcomes, uses six synthetic HTTP, preserves reports and refuses reexecution',async()=>{
 const p=await prepare();let calls=0,reads=0;const fixture=scoringQualityFixture(),authorization=auth(p.batch);
 const result=await executeScoringQuality(p.output,authorization,{sources,readCredential:()=>{reads++;return 'synthetic-quality-private';},fetch:async(i,n)=>{calls++;const wire=await new Request(i,n).clone().text();for(const c of p.batch.cases){expect(wire).not.toContain(c.reference.rationale);expect(wire).not.toContain(c.id);}expect(wire).not.toContain('assistant-authored-draft');return fixture(i,n);}},{execute:true,mode:'injected-test-only'});
 expect(result.report.status).toBe('passed-draft-checks');expect(calls).toBe(6);expect(result.report.analysis.protocolCompleted).toBe(8);expect(result.report.analysis.expectedOutcomeMatched).toBe(8);
 expect(result.report.analysis.qualityClaimEligible).toBe(false);expect(result.report.analysis.bandAgreement.ratio).toBe(1);expect(result.report.rows.every(r=>r.diagnostics.length>0)).toBe(true);
 const before=await readFile(result.reportPath,'utf8');expect((await inspectScoringQuality(p.output)).report.digest).toBe(result.report.digest);
 for(const field of ['analysis','totals']){const changed=JSON.parse(before);if(field==='analysis')changed.analysis.expectedOutcomeMatched--;else changed.totals.usedTokens++;
  const {digest,...body}=changed;changed.digest=contentHash(body);await writeFile(result.reportPath,JSON.stringify(changed));await expect(inspectScoringQuality(p.output)).rejects.toThrow('SCORING_QUALITY_REPORT_INVALID');}
 await writeFile(result.reportPath,before);
 await expect(executeScoringQuality(p.output,authorization,{sources,readCredential:()=>{reads++;throw Error();},fetch:async()=>{calls++;throw Error();}},{execute:true,mode:'injected-test-only'})).rejects.toThrow();
 expect(calls).toBe(6);expect(reads).toBe(6);expect(await readFile(result.reportPath,'utf8')).toBe(before);expect(before).not.toContain('synthetic-quality-private');
},30000);
test('a valid but semantically wrong zero stays zero and fails reference bands rather than becoming abstention',async()=>{
 const p=await prepare(),r=await executeScoringQuality(p.output,auth(p.batch),{sources,readCredential:()=> 'synthetic-quality',fetch:scoringQualityFixture({normalZero:true})},{execute:true,mode:'injected-test-only'});
 expect(r.report.status).toBe('failed-draft-checks');expect(r.report.analysis.protocolCompleted).toBe(8);expect(r.report.analysis.expectedOutcomeMatched).toBe(8);
 const normal=r.report.analysis.observations.filter(o=>o.category==='normal');expect(normal.every(o=>o.outcome==='scored'&&o.bands[0]?.predicted===0&&o.bands[0].matched===false)).toBe(true);
},30000);
test('model protocol failures are not counted as proper abstention and do not disappear from denominator',async()=>{
 const p=await prepare();const r=await executeScoringQuality(p.output,auth(p.batch),{sources,readCredential:()=> 'synthetic-quality',fetch:async()=>new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:'not-json'},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})},{execute:true,mode:'injected-test-only'});
 expect(r.report.analysis.total).toBe(8);expect(r.report.analysis.failed).toBe(6);expect(r.report.analysis.expectedOutcomeMatched).toBe(2);expect(r.report.totals.httpAttempts).toBe(6);
 expect(r.report.analysis.bandAgreement.ratio).toBeNull();expect(r.report.status).toBe('failed-draft-checks');
},30000);
test('unknown consumption stops remaining cases and is never re-requested by inspection',async()=>{
 const p=await prepare();let calls=0;const r=await executeScoringQuality(p.output,auth(p.batch),{sources,readCredential:()=> 'synthetic-quality',fetch:async()=>{calls++;throw Error('synthetic loss');}},{execute:true,mode:'injected-test-only'});
 expect(calls).toBe(1);expect(r.report.stoppedForAccounting).toBe(true);expect(r.report.analysis.unrun).toBe(7);expect(r.report.totals.heldCostMicros).toBeGreaterThan(0);await inspectScoringQuality(p.output);expect(calls).toBe(1);
},30000);
test('changed input and mismatched authorization reject before credential reads or HTTP',async()=>{
 const p=await prepare();let reads=0,calls=0;const deps={sources,readCredential:()=>{reads++;return 'no';},fetch:async()=>{calls++;throw Error();}};
 await expect(executeScoringQuality(p.output,{...auth(p.batch),maxRequests:7},deps,{execute:true,mode:'injected-test-only'})).rejects.toThrow();
 const file=join(p.output,'batch.json'),b=JSON.parse(await readFile(file,'utf8'));b.cases[0].answer+='changed';await writeFile(file,JSON.stringify(b));
 await expect(readScoringQualityBatch(p.output,{sources})).rejects.toThrow();await expect(executeScoringQuality(p.output,auth(p.batch),deps,{execute:true,mode:'injected-test-only'})).rejects.toThrow();expect(reads).toBe(0);expect(calls).toBe(0);
});

test('preexisting evaluation state is not reused or charged by a fresh claim',async()=>{
 const p=await prepare();await mkdir(join(p.output,'evaluation-state'));let reads=0,calls=0;
 const r=await executeScoringQuality(p.output,auth(p.batch),{sources,readCredential:()=>{reads++;return 'no';},fetch:async()=>{calls++;throw Error();}},{execute:true,mode:'injected-test-only'});
 expect(r.report.runError).toBe('SCORING_QUALITY_RUNTIME_FAILED');expect(r.report.analysis.unrun).toBe(8);expect(reads).toBe(0);expect(calls).toBe(0);await inspectScoringQuality(p.output);
});
