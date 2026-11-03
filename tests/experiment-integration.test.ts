import{test,expect}from'bun:test';
import{runExperimentDemo}from'../scripts/demo-policy-experiment.ts';
test('two role experiments reject, activate, rollback, replay and restore without changing prior pins',async()=>{
 for(const role of ['java-backend','web-frontend']as const){const r=await runExperimentDemo(role);
  expect(r.productionPublished).toBe(false);expect(r.scope).toBe('offline-experiment');expect(r.registryVersion).toBe(3);
  expect(r.rejectedActiveId).toBe(r.baselineId);expect(r.activatedActiveId).not.toBe(r.baselineId);expect(r.restoredActiveId).toBe(r.baselineId);
  expect(r.oldPin.policy.parameters.maxFollowupDepth).toBe(2);expect(r.newPin.policy.parameters.maxFollowupDepth).toBe(1);
 }
});
