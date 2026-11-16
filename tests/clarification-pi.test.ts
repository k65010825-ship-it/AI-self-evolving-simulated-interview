import { test,expect } from 'bun:test';
import { runClarificationDemo } from '../scripts/demo-agent-turn.ts';
test('both-role actual Pi local provider can clarify then grade a combined answer in separate isolated sessions',async()=>{
 for(const role of ['java-backend','web-frontend']as const){
  const d=await runClarificationDemo(role);
  expect(d.firstStatus).toBe('needs_clarification');expect(d.secondStatus).toBe('scored');
  expect(d.attempt).toBe(1);expect(d.observations).toBe(1);expect(d.normalizedScore).toBe(.5);
  expect(d.originalVersion).toBe(0);expect(d.providerCalls).toBe(2);expect(d.liveModelCalls).toBe(0);expect(d.committed).toBe(false);
 }
},15000);
