import{test,expect}from'bun:test';
import{runLearningRetestDemo}from'../scripts/demo-learning-retest.ts';
test('both synthetic role flows separate clicks, verified work, pairing and sufficient-data summaries',async()=>{
 for(const role of ['java-backend','web-frontend']as const){const r=await runLearningRetestDemo(role);
  expect(r.clickPair.status).toBe('ineligible');expect(r.verifiedPair.status).toBe('eligible');expect(r.singleSummary.mae).toBeNull();
  expect(r.syntheticBatchSummary.mae).toBeCloseTo(0.1);expect(r.syntheticBatchSummary.dataMode).toBe('synthetic');expect(r.committed).toBe(false);
 }
});
