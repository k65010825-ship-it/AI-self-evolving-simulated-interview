import { expect, test } from 'bun:test';
import { createScoringExecutor } from '../apps/agent/src/tools/scoring-executor.ts';
import { createPiScoringTool } from '../apps/agent/src/tools/pi-scoring-tool.ts';
const context = { userId: 'u', runId: 'r', attemptId: 'a', roleId: 'java-backend' as const,
  deadlineAt: Date.now() + 60000, answerId: 'answer-1', answerText: '事务边界与失败恢复',
  evidence: [{ id: 'e1', start: 0, end: 4, excerpt: '事务边界' }] };
const rubric = { id: 'java-v1', version: '1', roleId: 'java-backend', scope: 'technical-content',
  criteria: [
    { id: 'correctness', maxScore: 4, weight: 0.75, required: true },
    { id: 'depth', maxScore: 4, weight: 0.25, required: false },
  ] };
const input = { rubricId: 'java-v1', rubricVersion: '1',
  criterionScores: [{ criterionId: 'correctness', score: 4, evidenceIds: ['e1'] },
    { criterionId: 'depth', score: 2, evidenceIds: ['e1'] }] };

test('returns insufficient evidence without a numerical score when all optional dimensions are absent', async () => {
  const optional = { ...rubric, criteria: rubric.criteria.map(c => ({ ...c, required: false })) };
  const receipt = await createScoringExecutor(context, [optional])('a', { ...input, criterionScores: [] });
  expect(receipt.status).toBe('insufficient_evidence');
  expect(receipt.data?.normalizedScore).toBeNull(); expect(receipt.data?.coverageWeight).toBe(0);
});
test('Pi adapter returns the actual validated receipt and rechecks raw parameters', async () => {
  const tool = createPiScoringTool(context, [rubric]);
  // This adapter never reads SDK context; the host security context is captured above.
  const sdkContext = {} as Parameters<typeof tool.execute>[4];
  const valid = await tool.execute('a', input, undefined, undefined, sdkContext);
  expect(JSON.parse((valid.content[0] as { text: string }).text).data.normalizedScore).toBe(0.875);
  const invalid = await tool.execute('b', { ...input, userId: 'forged' }, undefined, undefined, sdkContext);
  expect(JSON.parse((invalid.content[0] as { text: string }).text).error.code).toBe('VALIDATION_ERROR');
});

test('calculates hand-checked weighted normalized score using host weights', async () => {
  const result = await createScoringExecutor(context, [rubric])('call-1', input);
  expect(result.status).toBe('ok'); expect(result.data?.normalizedScore).toBeCloseTo(0.875);
  expect(result.data?.coverageWeight).toBe(1); expect(result.data?.complete).toBe(true);
});
test('keeps optional dimensions null and marks partial coverage instead of inventing zero', async () => {
  const result = await createScoringExecutor(context, [rubric])('call-1', { ...input, criterionScores: [input.criterionScores[0]] });
  expect(result.data?.normalizedScore).toBe(1); expect(result.data?.coverageWeight).toBe(0.75);
  expect(result.data?.complete).toBe(false); expect(result.data?.missingDimensions).toEqual(['depth']);
  expect(result.data?.dimensions[1]?.score).toBeNull();
});
test('rejects missing mandatory dimensions and out-of-range scores', async () => {
  const run = createScoringExecutor(context, [rubric]);
  expect((await run('a', { ...input, criterionScores: [] })).error?.code).toBe('VALIDATION_ERROR');
  expect((await run('b', { ...input, criterionScores: [{ criterionId: 'correctness', score: 5, evidenceIds: ['e1'] }] })).error?.code)
    .toBe('VALIDATION_ERROR');
});
test('rejects invented evidence, duplicated criteria and model-supplied weights', async () => {
  const run = createScoringExecutor(context, [rubric]);
  for (const scores of [[{ criterionId: 'correctness', score: 4, evidenceIds: ['made-up'] }],
    [input.criterionScores[0], input.criterionScores[0]]]) {
    expect((await run('a', { ...input, criterionScores: scores })).error?.code).toBe('VALIDATION_ERROR');
  }
  expect((await run('b', { ...input, weights: [1, 0] })).error?.code).toBe('VALIDATION_ERROR');
});
test('checks role, rubric version and rubric existence separately', async () => {
  const run = createScoringExecutor(context, [rubric, { ...rubric, id: 'web-v1', roleId: 'web-frontend' }]);
  expect((await run('a', { ...input, rubricId: 'web-v1' })).error?.code).toBe('ROLE_FORBIDDEN');
  expect((await run('b', { ...input, rubricVersion: 'old' })).error?.code).toBe('VERSION_CONFLICT');
  expect((await run('c', { ...input, rubricId: 'missing' })).error?.code).toBe('NOT_FOUND');
});
test('rejects host evidence excerpts that do not actually match the answer', () => {
  expect(() => createScoringExecutor({ ...context, evidence: [{ id: 'e1', start: 0, end: 4, excerpt: '伪造摘录' }] }, [rubric]))
    .toThrow('VALIDATION_ERROR');
});
test('enforces cancellation, expiry and a bounded scoring-call budget', async () => {
  const controller = new AbortController(); controller.abort();
  expect((await createScoringExecutor(context, [rubric])('a', input, controller.signal)).error?.code).toBe('RUN_CANCELLED');
  expect((await createScoringExecutor({ ...context, deadlineAt: 0 }, [rubric])('a', input)).error?.code).toBe('DEADLINE_EXCEEDED');
  const run = createScoringExecutor(context, [rubric], { maxCalls: 1 });
  expect((await run('a', input)).status).toBe('ok');
  expect((await run('b', input)).error?.code).toBe('TOOL_BUDGET_EXCEEDED');
});
test('rejects mutable/invalid host rubric configuration and snapshots valid configuration', async () => {
  expect(() => createScoringExecutor(context, [{ ...rubric, criteria: [{ ...rubric.criteria[0]!, weight: 0.2 }] }]))
    .toThrow('VALIDATION_ERROR');
  const copy = structuredClone(rubric); const run = createScoringExecutor(context, [copy]);
  copy.criteria[0]!.weight = 0.01;
  expect((await run('a', input)).data?.normalizedScore).toBeCloseTo(0.875);
});
