import { test, expect } from 'bun:test';
import { loadKnowledgeWorkspace, createCuratedKnowledgeExecutor } from '../apps/agent/src/knowledge/catalog.ts';
import { buildKnowledgeCatalog } from '../apps/agent/src/knowledge/curation.ts';

const context = { userId: 'fixture', runId: 'fixture', attemptId: 'a', roleId: 'java-backend' as const, deadlineAt: Date.now() + 60000 };
test('expanded workspace contains 14 java and 15 web draft items and an empty real review ledger', () => {
  const w = loadKnowledgeWorkspace();
  expect(w.reviews).toHaveLength(0);
  expect(w.dossiers).toHaveLength(29);
  expect(w.items.filter(i => i.roleId === 'java-backend')).toHaveLength(14);
  expect(w.items.filter(i => i.roleId === 'web-frontend')).toHaveLength(15);
  for (const role of ['java-backend', 'web-frontend']) {
    const items = w.items.filter(i => i.roleId === role);
    expect(new Set(items.map(i => i.questionType)).size).toBe(4);
  }
  const c = buildKnowledgeCatalog(w);
  expect(c.items).toHaveLength(0);
  expect(c.summary.readyForHumanReview).toBe(22);
});

test('curated querying is fail-closed by default; preview exposes purpose-limited real guidance', async () => {
  const query = { roleId: 'java-backend', skillId: 'java-concurrency', query: 'updateAndGet', purpose: 'questioning', limit: 3 };
  const closed = await createCuratedKnowledgeExecutor(context)('closed', query);
  expect(closed.status).toBe('empty');
  const execute = createCuratedKnowledgeExecutor(context, { mode: 'draft-preview', maxCalls: 2 });
  const question = await execute('question', query);
  expect(question.data?.items).toHaveLength(1);
  expect(question.data?.items[0]!.reviewStatus).toBe('draft');
  expect(question.data?.guidance?.[0]!.answerGuide).toBeUndefined();
  expect(question.data?.guidance?.[0]!.followups).toHaveLength(1);
  const score = await execute('score', { ...query, purpose: 'scoring' });
  expect(score.data?.guidance?.[0]!.answerGuide).toContain('副作用');
  expect(score.data?.guidance?.[0]!.sourceReferences[0]!.sourceVersion).toBe('docs-2026-11-03');
  expect((await execute('wrong', { ...query, roleId: 'web-frontend' })).error?.code).toBe('ROLE_FORBIDDEN');
  expect((await execute('budget', query)).error?.code).toBe('TOOL_BUDGET_EXCEEDED');
});

test('preview keeps TopK, ownership, cancellation and catalog immutability', async () => {
  const execute = createCuratedKnowledgeExecutor(context, { mode: 'draft-preview', maxCalls: 3 });
  const query = { roleId: 'java-backend', skillId: 'spring-transactions', purpose: 'questioning', limit: 3 };
  const first = await execute('first', query);
  expect(first.data!.items.length).toBe(3);
  first.data!.guidance![0]!.followups[0]!.question = 'mutated';
  const next = await execute('next', query);
  expect(next.data!.guidance![0]!.followups[0]!.question).not.toBe('mutated');
  const abort = new AbortController(); abort.abort();
  expect((await execute('cancel', query, abort.signal)).error?.code).toBe('RUN_CANCELLED');
  expect((await execute('extra', { ...query, reviewedOnly: false })).error?.code).toBe('VALIDATION_ERROR');
});
