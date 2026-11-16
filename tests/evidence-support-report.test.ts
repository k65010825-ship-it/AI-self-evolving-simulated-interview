import { test, expect } from 'bun:test';
import { runEvidenceSupportMatrix } from '../evals/answers/evidence-support/runner.ts';
import { supportCases } from '../evals/answers/evidence-support/cases.ts';
import { evidenceSupportRejection } from '../packages/interview-domain/src/evidence-support.ts';
test('matrix report keeps semantic challenges outside the policy success denominator',()=>{
 const report=runEvidenceSupportMatrix();
 expect(report.summary).toEqual({regressions:28,matched:28,failed:0,knownLimits:5});
 expect(report.rows.filter(r=>r.lane==='known-limit')).toHaveLength(5);
 expect(report.humanReferenceCount).toBe(0);expect(report.qualityClaimEligible).toBe(false);
 expect(report.liveModelCalls).toBe(0);expect(report.origin).toBe('assistant-authored-synthetic-development');
 expect(report.datasetDigest).toMatch(/^[a-f0-9]{64}$/);expect(report.ruleDigest).toMatch(/^[a-f0-9]{64}$/);
 expect(report.status).toBe('passed-policy-regressions-with-known-limits');
});
test('synthetic cases are unique, exact quotations and known gaps have explanations',()=>{
 expect(new Set(supportCases.map(c=>c.id)).size).toBe(supportCases.length);
 for(const c of supportCases){expect(c.quotes.length).toBeGreaterThan(0);if(c.lane==='known-limit')expect(c.limitation?.length).toBeGreaterThan(20);}
});
test('reordering or repeating citations does not change the pure policy outcome',()=>{
 for(const c of supportCases){
  const criterion=c.dimension?{dimension:c.dimension}:{};
  const actual=evidenceSupportRejection(criterion,c.quotes,c.quotes.join('\n'));
  expect(evidenceSupportRejection(criterion,[...c.quotes].reverse(),c.quotes.join('\n'))).toBe(actual);
  expect(evidenceSupportRejection(criterion,[...c.quotes,...c.quotes],c.quotes.join('\n'))).toBe(actual);
 }
});
