import { createInterviewState } from '../apps/agent/src/planning/interview-state.ts';
import { evaluateTurn } from '../apps/agent/src/orchestration/evaluate-turn.ts';
// Deterministic fixture: these grades are supplied, not inferred by a real model.
const now = 1000000;
const state = createInterviewState({ sessionId: 'offline-turn-demo', roleId: 'java-backend', durationMinutes: 20,
  skills: [{ skillId: 'spring-transactions', relevance: 1 }, { skillId: 'java-concurrency', relevance: 1 }] }, now);
const proposal = await evaluateTurn({ state, expectedVersion: 0, observationId: 'demo-observation', goal: '练习事务',
  context: { userId: 'demo-user', runId: 'demo-run', attemptId: 'demo-attempt', roleId: 'java-backend', deadlineAt: now + 60000 },
  question: { id: 'demo-question', roleId: 'java-backend', skillId: 'spring-transactions',
    text: '如何界定事务边界？', questionType: 'technical', difficulty: 2 },
  answer: { id: 'demo-answer', text: '事务边界应覆盖一致性要求。' }, quality: 0.8, knowledge: [],
  rubric: { id: 'demo-content', version: 'draft-1', roleId: 'java-backend', scope: 'technical-content',
    criteria: [{ id: 'correctness', maxScore: 4, weight: 0.75, required: true },
      { id: 'depth', maxScore: 4, weight: 0.25, required: true }] },
}, { now: () => now, evaluate: async (_request, signal) => {
  signal.throwIfAborted();
  return { evidence: [{ id: 'e1', start: 0, end: 4, excerpt: '事务边界' }], criterionScores: [
    { criterionId: 'correctness', score: 4, evidenceIds: ['e1'] },
    { criterionId: 'depth', score: 2, evidenceIds: ['e1'] }],
    feedback: { strengths: ['提及事务边界'], improvements: ['补充异常回滚条件与外部系统一致性处理'] } };
} });
console.log(JSON.stringify({ mode: 'offline-turn-fixture', liveModelCalls: 0,
  committed: false, originalVersion: state.version, proposal }, null, 2));
