import { describe, expect, test } from 'bun:test';
import { createKnowledgeExecutor } from '../apps/agent/src/tools/knowledge-executor.ts';
import { createApiApp } from '../apps/api/src/app.ts';
import { rankSkills } from '../packages/interview-domain/src/planning.ts';

const context = { userId: 'student-fixture', runId: 'run-fixture', attemptId: 'attempt-1',
  roleId: 'java-backend' as const, deadlineAt: Date.now() + 60000 };
const input = { roleId: 'java-backend', skillId: 'spring-transactions', purpose: 'questioning', limit: 1 };

describe('role knowledge execution boundary', () => {
  test('returns actual role-scoped seed records and references', async () => {
    const execute = createKnowledgeExecutor(context);
    const receipt = await execute('call-1', input);
    expect(receipt.status).toBe('ok');
    expect(receipt.data?.items[0]?.id).toBe('java-scenario-transactions');
    expect(receipt.sourceIds).toContain('spring-transactions');
  });
  test('rejects another role even when the model supplies its roleId', async () => {
    const receipt = await createKnowledgeExecutor(context)('call-1', { ...input, roleId: 'web-frontend' });
    expect(receipt.error?.code).toBe('ROLE_FORBIDDEN');
  });
  test('returns empty without crossing roles for an unknown skill', async () => {
    const receipt = await createKnowledgeExecutor(context)('call-1', { ...input, skillId: 'unknown-skill' });
    expect(receipt.status).toBe('empty');
    expect(receipt.data?.items).toEqual([]);
  });
  test('does not perform another valid lookup after its call budget is used', async () => {
    const execute = createKnowledgeExecutor(context, { maxCalls: 1 });
    expect((await execute('call-1', input)).status).toBe('ok');
    expect((await execute('call-2', input)).error?.code).toBe('TOOL_BUDGET_EXCEEDED');
  });
  test('rejects cancelled, expired and schema-violating calls', async () => {
    const controller = new AbortController(); controller.abort();
    expect((await createKnowledgeExecutor(context)('cancelled', input, controller.signal)).error?.code).toBe('RUN_CANCELLED');
    expect((await createKnowledgeExecutor({ ...context, deadlineAt: 0 })('expired', input)).error?.code).toBe('DEADLINE_EXCEEDED');
    expect((await createKnowledgeExecutor(context)('invalid', { ...input, userId: 'administrator' })).error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('public scaffold API', () => {
  test('reports scaffold status and refuses to pretend an interview is implemented', async () => {
    const app = createApiApp();
    const healthResponse = await app.request('/health');
    expect(healthResponse.status).toBe(200);
    const health = await healthResponse.json();
    expect(health.stage).toBe('scaffold');
    expect(health.liveModelConfigured).toBe(false);
    const response = await app.request('/v1/interviews', { method: 'POST' });
    expect(response.status).toBe(501);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect((await response.json()).code).toBe('NOT_IMPLEMENTED');
  });
});

describe('planning uses cumulative confidence and remaining time', () => {
  const skills = [
    { skillId: 'transactions', relevance: 1, mastery: 0.8, confidence: 0.9, covered: true },
    { skillId: 'concurrency', relevance: 1, mastery: 0.8, confidence: 0.1, covered: true },
  ];
  test('prioritizes uncertainty even with the same mastery and last answer', () => {
    expect(rankSkills(skills, 600)[0]?.skillId).toBe('concurrency');
  });
  test('ends when the remaining interview budget is exhausted', () => {
    expect(rankSkills(skills, 0)).toEqual([]);
  });
});
