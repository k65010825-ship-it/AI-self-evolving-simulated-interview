import {test,expect} from 'bun:test';
import {loadScoringChallengeCases} from '../evals/scoring-quality/challenge.ts';
import {scoringQualityRequest} from '../evals/scoring-quality/dataset.ts';
import {parseScoringQualityArgs} from '../scripts/scoring-quality.ts';
import {prepareScoringQualityBatch,scoringQualityAuthorization} from '../evals/scoring-quality/batch.ts';
import {executeScoringQuality} from '../evals/scoring-quality/runner.ts';
import {scoringQualityFixture} from '../experiments/scoring-quality/fixture.ts';
test('challenge freezes both roles partial, mixed, wrong verification and zero-call abstention controls',()=>{
 const cases=loadScoringChallengeCases();expect(cases).toHaveLength(8);
 for(const role of ['java-backend','web-frontend']){
  const selected=cases.filter(c=>c.roleId===role);expect(selected.map(c=>c.category)).toEqual(['partial','mixed','verification','abstention']);
  const partial=selected[0]!,mixed=selected[1]!,wrong=selected[2]!;
  expect(partial.reference.bands.every(b=>b.min>0&&b.max<1)).toBe(true);
  expect(mixed.reference.bands.some(b=>b.max===0)).toBe(true);expect(mixed.reference.bands.some(b=>b.min>0)).toBe(true);
  expect(wrong.reference.bands).toHaveLength(1);expect(wrong.reference.bands[0]!.max).toBe(0);
  expect(wrong.item.rubric[0]!.verificationGoal).toBeDefined();
 }
 for(const sample of cases){const now=Date.now(),request=scoringQualityRequest(sample,now,now+30000,'challenge-'+sample.id),wire=JSON.stringify(request);
  expect(wire).not.toContain(sample.reference.rationale);expect(wire).not.toContain('bands');expect(sample.reference.origin).toBe('assistant-authored-draft');
 }
 expect(parseScoringQualityArgs(['prepare','--suite','challenge'])).toEqual({command:'prepare',suite:'challenge'});
});
test('challenge synthetic Pi rehearsal keeps mixed positive/zero scores and grounded wrong conclusions',async()=>{
 const sources=async()=>[{path:'package.json',sha256:'a'.repeat(64)}],p=await prepareScoringQualityBatch({suite:'challenge',sources,outputRoot:'.cache/scoring-challenge-tests'});
 expect(p.batch.stabilityPolicy).toEqual({version:1,runs:2,maxNormalizedDrift:.25});
 const r=await executeScoringQuality(p.output,scoringQualityAuthorization(p.batch,'injected-test-only',Date.now()+600000),{sources,readCredential:()=> 'synthetic',fetch:scoringQualityFixture()},{execute:true,mode:'injected-test-only'});
 expect(r.report.status).toBe('passed-draft-checks');expect(r.report.totals.httpAttempts).toBe(6);expect(r.report.analysis.bandAgreement.paired).toBe(8);
 for(const o of r.report.analysis.observations.filter(o=>o.category==='mixed'))expect(o.bands.map(b=>b.predicted)).toEqual([.75,0]);
 for(const o of r.report.analysis.observations.filter(o=>o.category==='verification')){expect(o.bindingValid).toBe(true);expect(o.bands[0]!.predicted).toBe(0);}
});
