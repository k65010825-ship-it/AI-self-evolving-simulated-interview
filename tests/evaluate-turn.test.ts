import { test, expect } from 'bun:test';
import { createInterviewState, AgentStateError } from '../apps/agent/src/planning/interview-state.ts';
import { evaluateTurn } from '../apps/agent/src/orchestration/evaluate-turn.ts';
let now = 1000000;
const state = () => createInterviewState({ sessionId: 'session', roleId: 'java-backend', durationMinutes: 20,
  skills: [{ skillId: 'transactions', relevance: 1 }, { skillId: 'concurrency', relevance: 1 }] }, 1000000);
const input = () => ({ state: state(), expectedVersion: 0, observationId: 'obs-1', goal: '事务练习',
  context: { userId: 'u', runId: 'r', attemptId: 'a', roleId: 'java-backend', deadlineAt: 2000000 },
  question: { id: 'q1', roleId: 'java-backend', skillId: 'transactions', questionType: 'technical', difficulty: 2,
    text: '解释事务边界' }, answer: { id: 'a1', text: '事务边界' }, quality: 0.8,
  rubric: { id: 'rubric', version: '1', roleId: 'java-backend', scope: 'technical-content',
    criteria: [{ id: 'correctness', maxScore: 4, weight: 0.75, required: true },
      { id: 'depth', maxScore: 4, weight: 0.25, required: false }] }, knowledge: [] });
const output = () => ({ evidence: [{ id: 'e1', start: 0, end: 4, excerpt: '事务边界' }], criterionScores: [
  { criterionId: 'correctness', score: 4, evidenceIds: ['e1'] }, { criterionId: 'depth', score: 2, evidenceIds: ['e1'] }],
  feedback: { strengths: ['提及事务边界'], improvements: ['补充异常处理条件'] } });
const deps = (evaluate: (request: any, signal: AbortSignal) => Promise<unknown> = async () => output()) => ({ evaluate, now: () => now, timeoutMs: 100 });

test('composes evidence grading, immutable state and next action without persistence', async () => {
  now = 1000000; const raw = input();
  const result = await evaluateTurn(raw, deps());
  expect(result.evaluation.normalizedScore).toBe(0.875); expect(result.nextState.version).toBe(1);
  expect(result.nextState.observations[0]?.quality).toBe(0.8);
  expect(result.evidence[0]?.excerpt).toBe('事务边界');
  expect(result.nextAction.skillId).toBe('concurrency'); expect(raw.state.observations).toHaveLength(0);
  expect(result.feedback.improvements).toEqual(['补充异常处理条件']);
});
test('passes complete answer, actual question and host rubric to evaluation but no identity fields', async () => {
  now = 1000000;
  await evaluateTurn(input(), deps(async (request) => {
    expect(request.question.text).toBe('解释事务边界'); expect(request.rubric.criteria[0].weight).toBe(0.75);
    expect(JSON.parse(request.context.userPrompt).answer.text).toBe('事务边界');
    expect(JSON.stringify(request)).not.toContain('attemptId'); return output();
  }));
});
test('rejects extra model authority and missing structural fields', async () => {
  now = 1000000;
  for (const bad of [{ ...output(), quality: 1 }, { criterionScores: [] }, 'invalid-json'])
    await expect(evaluateTurn(input(), deps(async () => bad))).rejects.toThrow('MODEL_OUTPUT_INVALID');
});
test('rejects invented excerpts, evidence IDs, missing required and partial scoring', async () => {
  now = 1000000;
  const fake = output(); fake.evidence[0]!.excerpt = '伪造证据';
  const unknown = output(); unknown.criterionScores[0]!.evidenceIds = ['fake'];
  const partial = output(); partial.criterionScores.pop();
  for (const bad of [fake, unknown, partial, { ...output(), criterionScores: [] }])
    await expect(evaluateTurn(input(), deps(async () => bad))).rejects.toThrow('MODEL_OUTPUT_INVALID');
});
test('rejects role mismatch, unknown skill and stale state before evaluator invocation', async () => {
  now = 1000000; let calls = 0; const backend = deps(async () => { calls++; return output(); });
  const role = input(); role.question.roleId = 'web-frontend';
  await expect(evaluateTurn(role, backend)).rejects.toThrow('ROLE_FORBIDDEN');
  const skill = input(); skill.question.skillId = 'unknown';
  await expect(evaluateTurn(skill, backend)).rejects.toThrow('VALIDATION_ERROR');
  const stale = input(); stale.expectedVersion = 1;
  await expect(evaluateTurn(stale, backend)).rejects.toThrow('VERSION_CONFLICT'); expect(calls).toBe(0);
});
test('rejects reused observation ID without reevaluation', async () => {
  now = 1000000; const first = await evaluateTurn(input(), deps());
  const raw = { ...input(), state: first.nextState, expectedVersion: 1 };
  await expect(evaluateTurn(raw, deps(async () => { throw new Error('should not call'); }))).rejects.toThrow('VERSION_CONFLICT');
});
test('rejects a question reused under another skill before evaluation', async () => {
  now = 1000000; const first = await evaluateTurn(input(), deps());
  const raw = { ...input(), state: first.nextState, expectedVersion: 1, observationId: 'obs-2' };
  raw.question.skillId = 'concurrency'; let calls = 0;
  await expect(evaluateTurn(raw, deps(async () => { calls++; return output(); }))).rejects.toThrow('VALIDATION_ERROR');
  expect(calls).toBe(0);
});
test('checks pre-abort and deadline before requesting evaluation', async () => {
  now = 1000000; const controller = new AbortController(); controller.abort();
  await expect(evaluateTurn(input(), { ...deps(), signal: controller.signal })).rejects.toThrow('RUN_CANCELLED');
  const raw = input(); raw.context.deadlineAt = now;
  await expect(evaluateTurn(raw, deps())).rejects.toThrow('DEADLINE_EXCEEDED');
});
test('external cancellation wins against a provider that ignores its signal', async () => {
  now = 1000000; const controller = new AbortController();
  const pending = evaluateTurn(input(), { ...deps(async () => new Promise(() => {})), signal: controller.signal });
  controller.abort(); await expect(pending).rejects.toThrow('RUN_CANCELLED');
});
test('times out hung evaluation and aborts the provider signal', async () => {
  now = 1000000; let signal: AbortSignal | undefined;
  await expect(evaluateTurn(input(), { ...deps(async (_r, s) => { signal = s; return new Promise(() => {}); }), timeoutMs: 5 }))
    .rejects.toThrow('DEADLINE_EXCEEDED'); expect(signal?.aborted).toBe(true);
});
test('late provider response cannot create a proposal after deadline', async () => {
  now = 1000000; const raw = input(); raw.context.deadlineAt = now + 10;
  await expect(evaluateTurn(raw, deps(async () => { now += 11; return output(); }))).rejects.toThrow('DEADLINE_EXCEEDED');
});
test('does not expose provider error details', async () => {
  now = 1000000;
  await expect(evaluateTurn(input(), deps(async () => { throw new Error('sensitive-provider-detail'); })))
    .rejects.toThrow('DEPENDENCY_UNAVAILABLE');
});
test('preserves typed evaluation adapter errors instead of misclassifying them as dependency failures', async () => {
  now = 1000000;
  await expect(evaluateTurn(input(), deps(async () => { throw new AgentStateError('MODEL_OUTPUT_INVALID'); })))
    .rejects.toThrow('MODEL_OUTPUT_INVALID');
});
test('evaluation request budget includes question and rubric, failing before dependency', async () => {
  now = 1000000;
  await expect(evaluateTurn(input(), { ...deps(async () => { throw new Error('should not call'); }), maxRequestCharacters: 20 }))
    .rejects.toThrow('CONTEXT_BUDGET_EXCEEDED');
});
test('proposal preserves host run identifiers accepted by the shared ToolContext contract', async () => {
  now = 1000000; const raw = input(); raw.context.runId = 'r'.repeat(120);
  const result = await evaluateTurn(raw, deps());
  expect(result.basedOn.runId).toBe(raw.context.runId);
});
