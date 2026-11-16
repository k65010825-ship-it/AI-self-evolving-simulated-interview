import {test,expect} from 'bun:test';
import {loadScoringQualityCases,loadScoringContrastCases,scoringQualityRequest} from '../evals/scoring-quality/dataset.ts';
import {prepareScoringQualityBatch,scoringQualityAuthorization} from '../evals/scoring-quality/batch.ts';
import {executeScoringQuality,inspectScoringQuality} from '../evals/scoring-quality/runner.ts';
import {scoringQualityFixture} from '../experiments/scoring-quality/fixture.ts';
test('new contrast wording contains assessable wrong controls and preserves original baseline inputs/references',()=>{
 const baseline=loadScoringQualityCases(),before=JSON.stringify(baseline),contrast=loadScoringContrastCases();expect(contrast).toHaveLength(8);
 for(const role of ['java-backend','web-frontend']){const selected=contrast.filter(c=>c.roleId===role);expect(selected.map(c=>c.category).sort()).toEqual(['abstention','incorrect','insufficient','normal']);
  for(const c of selected){expect(baseline.some(b=>b.answer===c.answer)).toBe(false);expect(c.reference.origin).toBe('assistant-authored-draft');}
  const wrong=selected.find(c=>c.category==='incorrect')!;expect(wrong.expectedOutcome).toBe('scored');expect(wrong.reference.bands.every(b=>b.min===0&&b.max===0)).toBe(true);
  const req=scoringQualityRequest(wrong,Date.now(),Date.now()+30000,'wrong-'+role);expect(JSON.stringify(req)).not.toContain(wrong.reference.rationale);
 }
 expect(JSON.stringify(loadScoringQualityCases())).toBe(before);
});
test('contrast suite independently exercises grounded zero, positive score, clarification and zero-call abstention through Pi',async()=>{
 const sources=async()=>[{path:'package.json',sha256:'b'.repeat(64)}],p=await prepareScoringQualityBatch({suite:'contrast',sources,outputRoot:'.cache/scoring-quality-contrast-tests'});let calls=0;
 const fixture=scoringQualityFixture();const r=await executeScoringQuality(p.output,scoringQualityAuthorization(p.batch,'injected-test-only',Date.now()+600000),{sources,readCredential:()=> 'synthetic-contrast-private',fetch:async(i,n)=>{calls++;return fixture(i,n);}},{execute:true,mode:'injected-test-only'});
 expect(r.report.status).toBe('passed-draft-checks');expect(r.report.analysis.expectedOutcomeMatched).toBe(8);expect(r.report.analysis.bandAgreement).toEqual({matched:4,paired:4,ratio:1});expect(calls).toBe(6);
 const wrong=r.report.analysis.observations.filter(o=>o.category==='incorrect');expect(wrong.every(o=>o.outcome==='scored'&&o.bands[0]?.predicted===0)).toBe(true);
 expect((await inspectScoringQuality(p.output)).report.digest).toBe(r.report.digest);
},30000);
