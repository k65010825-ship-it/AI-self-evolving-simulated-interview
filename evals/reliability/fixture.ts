import { AgentRunRequestSchema, type AgentRunRequest } from '../../packages/contracts/src/agent-run.ts';
import { createInterviewState } from '../../apps/agent/src/planning/interview-state.ts';
import type { RoleId } from '../../packages/contracts/src/tools.ts';
export function reliabilityRequest(id: string, roleId: RoleId = 'java-backend', marker = '隔离甲一') {
  const now = Date.now(), skillId = roleId === 'java-backend' ? 'java-concurrency' : 'javascript';
  const context = { userId: `fixture-user-${id}`, roleId, runId: id, attemptId: 'attempt-1', deadlineAt: now + 10000 };
  const state = createInterviewState({ sessionId: `session-${id}`, roleId, durationMinutes: 20, skills: [{ skillId, relevance: 1 }] }, now);
  return AgentRunRequestSchema.parse({ inputSnapshotId: `snapshot-${id}`, context, job: { type: 'turn', input: {
    state, expectedVersion: 0, observationId: `observation-${id}`, goal: '本地隔离评测', context,
    question: { id: `question-${id}`, roleId, skillId, questionType: 'technical', difficulty: 1, text: '解释一个边界条件' },
    answer: { id: `answer-${id}`, text: marker }, quality: 1, knowledge: [],
    rubric: { id: 'fixture-rubric', version: '1', roleId, scope: 'technical-content', criteria: [{ id: 'correctness', maxScore: 4, weight: 1, required: true }] },
  }, knowledge: [], askedQuestionIds: [], allowDraftKnowledge: false } }) as AgentRunRequest & { job: Extract<AgentRunRequest['job'], { type: 'turn' }> };
}
export const assessment = (text: string) => ({ evidence: [{ id: 'e', start: 0, end: text.length, excerpt: text }],
  criterionScores: [{ criterionId: 'correctness', score: 1, evidenceIds: ['e'] }], feedback: { strengths: ['提供证据'], improvements: ['补充边界'] } });
export function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
export async function until(check: () => boolean) {
  const end = performance.now() + 3000;
  while (!check()) { if (performance.now() >= end) throw new Error('RELIABILITY_WAIT_TIMEOUT'); await new Promise(r => setTimeout(r, 1)); }
}
