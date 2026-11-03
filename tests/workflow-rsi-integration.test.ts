import{test,expect}from'bun:test';
import{runWorkflowRsiHttpDemo}from'../scripts/demo-workflow-rsi-http.ts';
for(const role of ['java-backend','web-frontend']as const){
 test(`${role} closeout RSI uses HTTP/SSE and typed SDK without publishing a strategy`,async()=>{
  const d=await runWorkflowRsiHttpDemo(role);expect(d.status).toBe('evaluated_activated_offline');expect(d.baseline).toBe(.5);expect(d.candidate).toBe(1);
  expect(d.registryVersion).toBe(1);expect(d.replayStatus).toBe('replayed');expect(d.replayVersion).toBe(1);
  expect(d.eventTypes).toContain('rsi.completed');expect(d.oldDepth).toBe(2);expect(d.previewDepth).toBe(1);expect(d.productionPublished).toBe(false);expect(d.liveModelCalls).toBe(0);
 });
}
