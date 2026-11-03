import {test,expect} from 'bun:test';
import {runMemoryDemo} from '../scripts/demo-agent-memory.ts';
test('two role demos recover JSON and use different questions across two isolated SDK sessions',async()=>{
 for(const role of ['java-backend','web-frontend'] as const){
  const result=await runMemoryDemo(role);
  expect(result.memory.sessions).toHaveLength(2);expect(result.memory.version).toBe(2);
  expect(result.firstQuestionId).not.toBe(result.secondQuestionId);expect(result.before.currentAnswers).toBe(0);
  expect(result.after.currentAnswers).toBe(1);expect(result.liveModelCalls).toBe(0);
 }
});
