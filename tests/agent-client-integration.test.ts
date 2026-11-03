import{test,expect}from'bun:test';
import{runAgentClientDemo}from'../scripts/demo-agent-client.ts';
for(const roleId of ['java-backend','web-frontend']as const){
 test(`${roleId} backend client package runs complete workflow over TCP/SSE`,async()=>{
  const d=await runAgentClientDemo(roleId);expect(d.client).toBe('sdk');expect(d.transport).toBe('tcp');expect(d.phase).toBe('completed');
  expect(d.revisionHistory).toEqual([0,1,2,3,4,5,5,5]);expect(d.questionCount).toBe(2);expect(d.liveModelCalls).toBe(0);expect(d.committed).toBe(false);
 });
}
