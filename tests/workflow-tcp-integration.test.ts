import{test,expect}from'bun:test';
import{runWorkflowHttpDemo}from'../scripts/demo-workflow-http.ts';
for(const role of ['java-backend','web-frontend']as const){
 test(`${role} completes all five workflow operations and finish retry over TCP/SSE`,async()=>{
  const d=await runWorkflowHttpDemo(role);expect(d.phase).toBe('completed');expect(d.sessionVersion).toBe(2);
  expect(d.revisionHistory).toEqual([0,1,2,3,4,5,5,5]);expect(d.questionCount).toBe(2);expect(d.memoryVersion).toBe(1);
  expect(d.actions).toEqual(['create','plan','answer','plan','answer','finish','finish','restore']);
  expect(d.liveModelCalls).toBe(0);expect(d.committed).toBe(false);
 });
}
