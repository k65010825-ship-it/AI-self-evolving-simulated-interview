import {test,expect} from 'bun:test';
import {loadScoringQualityCases} from '../evals/scoring-quality/dataset.ts';
import {analyzeScoringQuality} from '../evals/scoring-quality/metrics.ts';
test('failed and unrun cases stay in every acceptance denominator, not disguised as abstention',()=>{
 const cases=loadScoringQualityCases(),rows=cases.map(c=>({caseId:c.id,status:'not_run',requestDigest:null,snapshot:null,errorCode:null,diagnostics:[]}));
 const result=analyzeScoringQuality(cases,rows);
 expect(result.total).toBe(8);expect(result.protocolCompleted).toBe(0);expect(result.expectedOutcomeMatched).toBe(0);expect(result.unrun).toBe(8);
 expect(result.draftChecksPassed).toBe(false);expect(result.bandAgreement).toEqual({matched:0,paired:0,ratio:null});
 expect(result.humanReferenceCount).toBe(0);expect(result.qualityClaimEligible).toBe(false);
 for(const role of result.roles){expect(role.total).toBe(4);expect(role.outcomeMatched).toBe(0);}
 expect(()=>analyzeScoringQuality(cases,rows.slice(1))).toThrow('SCORING_QUALITY_REPORT_INVALID');
 expect(()=>analyzeScoringQuality(cases,[rows[0],rows[0],...rows.slice(2)])).toThrow('SCORING_QUALITY_REPORT_INVALID');
});
