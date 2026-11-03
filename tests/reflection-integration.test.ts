import{test,expect}from'bun:test';
import{runReflectionDemo}from'../scripts/demo-agent-reflection.ts';
test('both role fixtures explain candidate generation and synthetic before/after without publishing',async()=>{
 for(const role of ['java-backend','web-frontend']as const){const result=await runReflectionDemo(role);
  expect(result.reflection.roleId).toBe(role);expect(result.evaluation.baseline.value).toBe(0.5);
  expect(result.evaluation.candidate.value).toBe(1);expect(result.evaluation.deploymentStatus).toBe('not_published');
  expect(result.reflection.calibration.mae).toBeNull();expect(result.liveModelCalls).toBe(0);
 }
});
