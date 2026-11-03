import { test, expect } from 'bun:test';
import { loadAnswerBundle, getBenchmarkKnowledge } from '../evals/answers/dataset.ts';
import { runAnswerBenchmark, runOfflineAnswerBenchmark } from '../evals/answers/runner.ts';
import type { EvaluationRequest } from '../apps/agent/src/orchestration/evaluate-turn.ts';
function validOutput(request: EvaluationRequest) {
  const answer = JSON.parse(request.context.userPrompt).answer.text as string;
  return { evidence: [{ id: 'e1', start: 0, end: answer.length, excerpt: answer }],
    criterionScores: request.rubric.criteria.map(c => ({ criterionId: c.id, score: c.maxScore / 2, evidenceIds: ['e1'] })),
    feedback: { strengths: [], improvements: ['fixture'] } };
}

test('benchmark requests are blind to references and metadata, and each real Pi fixture prediction is retained', async () => {
  const seen: unknown[] = [];
  const r = await runOfflineAnswerBenchmark('development', request => { seen.push(request); });
  expect(r.rows).toHaveLength(6);
  expect(r.rows.every(row => row.status === 'completed')).toBe(true);
  expect(seen).toHaveLength(6);
  const text = JSON.stringify(seen);
  for (const forbidden of ['caseDigest', 'rationale', 'synthetic-proposed', 'misconception', 'split', 'groupId', 'caseId', 'answerGuide', 'reference']) expect(text).not.toContain(`"${forbidden}"`);
  for (const role of r.analysis.roles) {
    expect(role.criterionError.mae).toBeCloseTo(.5);
    expect(role.nullAgreement.overScored).toBe(2);
    expect(role.humanReferenceMae).toBeNull();
  }
  expect(r.evaluatorMode).toBe('offline-fixture');
}, 15000);

test('malformed evidence is a failed row with no raw error or answer in the report', async () => {
  let calls = 0;
  const r = await runAnswerBenchmark(loadAnswerBundle(), getBenchmarkKnowledge(), { split: 'development', evaluatorId: 'bad-fixture', evaluate: async () => {
    calls++;
    if (calls === 1) throw new Error('SECRET_TOKEN_private_answer');
    return { evidence: [{ id: 'fake', start: 0, end: 1, excerpt: 'not-in-answer' }], criterionScores: [], feedback: { strengths: [], improvements: ['bad'] } };
  } });
  expect(calls).toBe(6);
  expect(r.analysis.roles.every(role => role.failureCount === 3 && role.criterionError.mae === null)).toBe(true);
  expect(JSON.stringify(r)).not.toContain('SECRET_TOKEN');
  expect(JSON.stringify(r)).not.toContain('not-in-answer');
  expect(r.rows.every(row => row.status !== 'completed')).toBe(true);
});

test('hung/ignored abort and pre-cancel cannot publish late successful projections', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const cancelled = await runAnswerBenchmark(loadAnswerBundle(), getBenchmarkKnowledge(), { split: 'validation', evaluatorId: 'cancel-fixture',
    signal: controller.signal, evaluate: async () => { calls++; throw new Error('not called'); } });
  expect(calls).toBe(0);
  expect(cancelled.rows.every(r => r.status === 'cancelled')).toBe(true);
  const resolvers: (() => void)[] = [], pending: Promise<unknown>[] = [];
  const hung = await runAnswerBenchmark(loadAnswerBundle(), getBenchmarkKnowledge(), { split: 'development', evaluatorId: 'hung-fixture',
    timeoutMs: 5, evaluate: request => {
      const p = new Promise(resolve => resolvers.push(() => resolve(validOutput(request)))); pending.push(p); return p;
    } });
  expect(hung.rows.every(r => r.status === 'timed_out')).toBe(true);
  const before = JSON.stringify(hung);
  resolvers.forEach(resolve => resolve()); await Promise.all(pending);
  expect(JSON.stringify(hung)).toBe(before);
});

test('deadline is checked even when synchronous evaluator work delays the timer callback', async () => {
  const r = await runAnswerBenchmark(loadAnswerBundle(), getBenchmarkKnowledge(), { split: 'development', evaluatorId: 'cpu-fixture', timeoutMs: 2,
    evaluate: async request => { const start = performance.now(); while (performance.now() - start < 10) { /* simulate a synchronous dependency */ } return validOutput(request); } });
  expect(r.rows.every(row => row.status === 'timed_out')).toBe(true);
});

test('reserved final and invalid run options fail before evaluator work', async () => {
  let calls = 0;
  const options = { evaluatorId: 'fixture', evaluate: async () => { calls++; return {}; } };
  await expect(runAnswerBenchmark(loadAnswerBundle(), getBenchmarkKnowledge(), { ...options, split: 'reserved-final' as 'development' })).rejects.toThrow('ANSWER_SPLIT_FORBIDDEN');
  await expect(runAnswerBenchmark(loadAnswerBundle(), getBenchmarkKnowledge(), { ...options, split: 'development', timeoutMs: 0 })).rejects.toThrow('ANSWER_BENCHMARK_INVALID');
  expect(calls).toBe(0);
});

test('cancellation during inference wins against a dependency returning a valid late answer', async () => {
  const controller = new AbortController(); let calls = 0;
  const r = await runAnswerBenchmark(loadAnswerBundle(), getBenchmarkKnowledge(), { split: 'development', evaluatorId: 'ignored-abort-fixture',
    signal: controller.signal, evaluate: async request => { calls++; controller.abort(); return validOutput(request); } });
  expect(calls).toBe(1);
  expect(r.rows.every(row => row.status === 'cancelled')).toBe(true);
  expect(r.analysis.roles.every(role => role.completedCount === 0)).toBe(true);
});
