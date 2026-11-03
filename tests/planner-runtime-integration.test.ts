import{test,expect}from'bun:test';
import{runPlannerRuntimeDemo}from'../scripts/demo-planner-runtime.ts';
for(const role of ['java-backend','web-frontend']as const){
 test(`${role} HTTP/SSE turn queries real knowledge tool before selecting next question`,async()=>{
  const d=await runPlannerRuntimeDemo(role);expect(d.turnStatus).toBe('completed');expect(d.reportStatus).toBe('completed');
  expect(d.planningToolCalls).toBe(1);expect(d.planningModelMessages).toBe(2);expect(d.eventTypes).toContain('question.completed');
  expect(d.liveModelCalls).toBe(0);expect(d.committed).toBe(false);
 });
}
