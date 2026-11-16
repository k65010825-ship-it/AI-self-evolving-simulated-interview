import {test,expect} from 'bun:test';
import {prepareScoringQualityBatch,scoringQualityAuthorization} from '../evals/scoring-quality/batch.ts';
import {executeScoringQuality} from '../evals/scoring-quality/runner.ts';
import {scoringQualityFixture} from '../experiments/scoring-quality/fixture.ts';
import {compareScoringQuality} from '../evals/scoring-quality/stability.ts';
const sources=async()=>[{path:'package.json',sha256:'b'.repeat(64)}];
async function run(partialScore:1|2|3=2,failed=false,manifest=sources){
 const p=await prepareScoringQualityBatch({suite:'challenge',sources:manifest,outputRoot:'.cache/scoring-stability-tests'});
 await executeScoringQuality(p.output,scoringQualityAuthorization(p.batch,'injected-test-only',Date.now()+600000),{sources:manifest,readCredential:()=> 'synthetic',fetch:failed?async()=>new Response('synthetic',{status:500}):scoringQualityFixture({partialScore})},{execute:true,mode:'injected-test-only'});return p.output;
}
test('two independent fixed-input runs compare outcomes and all dimension pairs without model calls',async()=>{
 const a=await run(),b=await run(3),r=await compareScoringQuality(a,b);
 expect(r.outcomeConsistent).toBe(8);expect(r.expectedDimensionPairs).toBe(8);expect(r.pairedDimensions).toBe(8);expect(r.maxAbsoluteDrift).toBe(.25);expect(r.draftStabilityPassed).toBe(true);expect(r.qualityClaimEligible).toBe(false);
 await expect(compareScoringQuality(a,a)).rejects.toThrow('SCORING_STABILITY_INPUT_MISMATCH');
 const c=await run(1),drift=await compareScoringQuality(c,b);expect(drift.bothDraftChecksPassed).toBe(true);expect(drift.maxAbsoluteDrift).toBe(.5);expect(drift.draftStabilityPassed).toBe(false);
});
test('matching failures are not stable, and missing score pairs remain in the denominator',async()=>{
 const a=await run(2,true),b=await run(2,true),r=await compareScoringQuality(a,b);
 expect(r.outcomeConsistent).toBe(0);expect(r.expectedDimensionPairs).toBe(8);expect(r.pairedDimensions).toBe(0);expect(r.missingDimensionPairs).toBe(8);expect(r.draftStabilityPassed).toBe(false);expect(r.meanAbsoluteDrift).toBeNull();
});
test('comparison refuses otherwise valid executions from different frozen sources',async()=>{
 const a=await run(),b=await run(2,false,async()=>[{path:'package.json',sha256:'c'.repeat(64)}]);
 await expect(compareScoringQuality(a,b)).rejects.toThrow('SCORING_STABILITY_INPUT_MISMATCH');
});
