import { pathToFileURL } from 'node:url';
import java from '../knowledge/java-backend/seed.json' with { type: 'json' };
import web from '../knowledge/web-frontend/seed.json' with { type: 'json' };
import { createEvaluationFixture } from '../experiments/pi-sdk/evaluation-fixture.ts';
import { createPiEvaluator } from '../apps/agent/src/adapters/pi/evaluator.ts';
import { selectNextQuestion } from '../apps/agent/src/planning/select-question.ts';
import { createInterviewState } from '../apps/agent/src/planning/interview-state.ts';
import { evaluateTurn } from '../apps/agent/src/orchestration/evaluate-turn.ts';
import type { RoleId } from '../packages/contracts/src/tools.ts';

/** Real SDK, local provider, draft knowledge: no official submission or model-quality claims. */
export async function runPiInterviewDemo(roleId: RoleId = 'java-backend') {
  const knowledge = roleId === 'java-backend' ? java : web;
  const now = Date.now();
  const state = createInterviewState({ sessionId: 'demo-pi-interview', roleId, durationMinutes: 20,
    skills: knowledge.slice(0, 2).map((k, i) => ({ skillId: k.skillId, relevance: i === 0 ? 1 : 0.9 })) }, now);
  const initial = selectNextQuestion({ state, now, knowledge, askedQuestionIds: [] }, { allowDraftKnowledge: true });
  if (initial.status !== 'selected') throw new Error('Offline demo requires a question');
  const answer = { id: 'demo-answer', text: roleId === 'java-backend' ? '事务边界需要说明，缓存失败还要设计重试。' : '状态更新需要考虑过期请求和组件卸载。' };
  const fixture = await createEvaluationFixture(() => ({ text: JSON.stringify({
    evidence: [{ id: 'e1', start: 0, end: 4, excerpt: answer.text.slice(0, 4) }],
    criterionScores: initial.rubric.criteria.map(c => ({ criterionId: c.id, score: c.maxScore * 0.75, evidenceIds: ['e1'] })),
    feedback: { strengths: ['本地替身提供的演示反馈'], improvements: ['后续用人工参考集验证语义评分'] },
  }) }));
  const evaluate = createPiEvaluator({ cwd: process.cwd(), modelRuntime: fixture.runtime, model: fixture.model, roleId });
  const turnInput = { state, expectedVersion: state.version, observationId: 'demo-observation', goal: '验证离线闭环',
    context: { userId: 'demo', runId: 'demo-run', attemptId: 'demo-attempt', roleId, deadlineAt: now + 60000 },
    question: initial.question, answer, quality: 0.8, rubric: initial.rubric, knowledge: [] };
  const proposal = await evaluateTurn(turnInput, { evaluate });
  const next = selectNextQuestion({ state: proposal.nextState, now: Date.now(), knowledge,
    askedQuestionIds: [initial.question.id] }, { allowDraftKnowledge: true });
  return { mode: 'real-pi-local-provider', roleId, liveModelCalls: fixture.stats.liveModelCalls,
    providerCalls: fixture.stats.providerCalls, committed: false, initial, proposal, next,
    reportInput: { state: proposal.nextState, generatedAt: Date.now(), policyVersion: 'heuristic-v0',
      skillLabels: Object.fromEntries(knowledge.slice(0,2).map((k,i) => [k.skillId,
        roleId === 'java-backend' ? (i === 0 ? '事务与一致性' : 'Java并发') : (i === 0 ? '异步状态管理' : 'JavaScript闭包')])),
      turns: [{ input: turnInput, proposal, evidenceMode: 'offline-fixture' as const }] } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const role of ['java-backend', 'web-frontend'] as const) console.log(JSON.stringify(await runPiInterviewDemo(role), null, 2));
}
