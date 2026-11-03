import { test, expect } from 'bun:test';
import { createEvaluationFixture, fixtureAssessment } from '../experiments/pi-sdk/evaluation-fixture.ts';
import { createPiEvaluator } from '../apps/agent/src/adapters/pi/evaluator.ts';
import { buildInterviewContext } from '../apps/agent/src/context/build-context.ts';
import { createInterviewState } from '../apps/agent/src/planning/interview-state.ts';
import type { EvaluationRequest } from '../apps/agent/src/orchestration/evaluate-turn.ts';
const now = 1000000;
const request = (): EvaluationRequest => ({ outputSchemaVersion: 1,
  context: buildInterviewContext({ state: createInterviewState({ sessionId: 'private', roleId: 'java-backend', durationMinutes: 20,
    skills: [{ skillId: 'transactions', relevance: 1 }] }, now), now, goal: '事务练习', phase: 'scoring', answer: '事务边界', knowledge: [] }),
  question: { text: '解释事务边界', skillId: 'transactions', questionType: 'technical', difficulty: 2 },
  rubric: { id: 'r', version: '1', roleId: 'java-backend', scope: 'technical-content',
    criteria: [{ id: 'correctness', maxScore: 4, weight: 1, required: true, description: '正确说明事务边界' }] } });
const signal = () => new AbortController().signal;
test('real Pi validates structured JSON, sends no tools and isolates each evaluation history', async () => {
  const fixture = await createEvaluationFixture(context => {
    const systems = context.messages.filter(m => m.role === 'system');
    expect(systems.flatMap(m => m.toolsAdded ?? [])).toHaveLength(0);
    expect(context.messages.filter(m => m.role === 'user')).toHaveLength(1);
    expect(context.messages.filter(m => m.role === 'assistant')).toHaveLength(0);
    expect(JSON.stringify(systems)).toContain('EvaluationOutput');
    expect(JSON.stringify(context.messages)).not.toContain('private');
    return { text: JSON.stringify(fixtureAssessment) };
  });
  const evaluate = createPiEvaluator({ cwd: process.cwd(), modelRuntime: fixture.runtime, model: fixture.model, roleId: 'java-backend' });
  expect(await evaluate(request(), signal())).toEqual(fixtureAssessment);
  expect(await evaluate(request(), signal())).toEqual(fixtureAssessment);
  expect(fixture.stats.providerCalls).toBe(2); expect(fixture.stats.liveModelCalls).toBe(0);
});
test('rejects invalid JSON, extra model fields, truncated completion and unexpected tool calls', async () => {
  for (const reply of [{ text: '```json\n{}\n```' }, { text: JSON.stringify({ ...fixtureAssessment, roleId: 'admin' }) },
    { text: JSON.stringify(fixtureAssessment), stopReason: 'length' as const }, { text: '', stopReason: 'toolUse' as const }]) {
    const fixture = await createEvaluationFixture(() => reply);
    const evaluate = createPiEvaluator({ cwd: process.cwd(), modelRuntime: fixture.runtime, model: fixture.model, roleId: 'java-backend' });
    await expect(evaluate(request(), signal())).rejects.toThrow('MODEL_OUTPUT_INVALID');
  }
});
test('checks role and request budget before invoking provider', async () => {
  const fixture = await createEvaluationFixture();
  const config = { cwd: process.cwd(), modelRuntime: fixture.runtime, model: fixture.model, roleId: 'web-frontend' as const };
  await expect(createPiEvaluator(config)(request(), signal())).rejects.toThrow('ROLE_FORBIDDEN');
  await expect(createPiEvaluator({ ...config, roleId: 'java-backend', maxRequestCharacters: 20 })(request(), signal()))
    .rejects.toThrow('CONTEXT_BUDGET_EXCEEDED'); expect(fixture.stats.providerCalls).toBe(0);
});
test('rejects oversized final response', async () => {
  const fixture = await createEvaluationFixture(() => ({ text: 'a'.repeat(1000) }));
  const evaluate = createPiEvaluator({ cwd: process.cwd(), modelRuntime: fixture.runtime, model: fixture.model,
    roleId: 'java-backend', maxOutputCharacters: 100 });
  await expect(evaluate(request(), signal())).rejects.toThrow('MODEL_OUTPUT_INVALID');
});
test('pre-cancel avoids provider; in-flight cancel stops real SDK stream', async () => {
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  const fixture = await createEvaluationFixture(() => { entered(); return new Promise(() => {}); });
  const evaluate = createPiEvaluator({ cwd: process.cwd(), modelRuntime: fixture.runtime, model: fixture.model, roleId: 'java-backend' });
  const controller = new AbortController(); controller.abort();
  await expect(evaluate(request(), controller.signal)).rejects.toThrow('RUN_CANCELLED'); expect(fixture.stats.providerCalls).toBe(0);
  const running = new AbortController(); const pending = evaluate(request(), running.signal);
  await started; running.abort(); await expect(pending).rejects.toThrow('RUN_CANCELLED');
  expect(fixture.stats.aborted).toBe(1);
});
test('bounds evaluation wait independently of the outer orchestrator', async () => {
  const fixture = await createEvaluationFixture(() => new Promise(() => {}));
  const evaluate = createPiEvaluator({ cwd: process.cwd(), modelRuntime: fixture.runtime, model: fixture.model,
    roleId: 'java-backend', timeoutMs: 30 });
  await expect(evaluate(request(), signal())).rejects.toThrow('DEADLINE_EXCEEDED');
});
test('classifies provider failure as dependency unavailable', async () => {
  const fixture = await createEvaluationFixture(() => { throw new Error('provider-secret-detail'); });
  const evaluate = createPiEvaluator({ cwd: process.cwd(), modelRuntime: fixture.runtime, model: fixture.model, roleId: 'java-backend' });
  await expect(evaluate(request(), signal())).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
});
