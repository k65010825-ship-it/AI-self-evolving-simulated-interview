import { createInterviewState } from '../apps/agent/src/planning/interview-state.ts';
import { buildInterviewContext } from '../apps/agent/src/context/build-context.ts';
const now = 1000000;
const state = createInterviewState({ sessionId: 'demo-session', roleId: 'java-backend', durationMinutes: 20,
  skills: [{ skillId: 'spring-transactions', relevance: 1 }] }, now);
const result = buildInterviewContext({ state, now, goal: '验证事务知识表达', phase: 'questioning',
  answer: '我会先解释事务边界。', knowledge: [] });
console.log(JSON.stringify({ mode: 'offline-context-demo', promptVersion: result.promptVersion,
  audit: result.audit, payload: JSON.parse(result.userPrompt) }, null, 2));
