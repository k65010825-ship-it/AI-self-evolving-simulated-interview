import { createInterviewState, recordObservation, estimateSkills, decideNextAction } from '../apps/agent/src/planning/interview-state.ts';
// Explicit clock makes the demonstration reproducible instead of depending on today's wall time.
const startedAt = 1000000;
let state = createInterviewState({ sessionId: 'state-demo', roleId: 'java-backend', durationMinutes: 20,
  skills: [{ skillId: 'spring-transactions', relevance: 1 }, { skillId: 'java-concurrency', relevance: 1 }] }, startedAt);
console.log('初始状态（未知不等于零分）', estimateSkills(state, startedAt));
state = recordObservation(state, { observationId: 'observation-1', questionId: 'transaction-question-1',
  roleId: 'java-backend', skillId: 'spring-transactions', questionType: 'scenario', difficulty: 2,
  score: 0.3, quality: 1, observedAt: startedAt + 1000 }, state.version, startedAt + 1000);
console.log('加入回答证据后的能力估计', estimateSkills(state, startedAt + 1000));
console.log('下一步建议', decideNextAction(state, startedAt + 1000));
console.log('剩余十秒时收尾', decideNextAction(state, state.deadlineAt - 10000));
console.log('边界：这是确定性状态/规划演示，不调用真实 LLM，不保存数据库，也不提交正式面试结果。');
