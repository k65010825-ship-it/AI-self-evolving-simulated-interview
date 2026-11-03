import { expect, test } from 'bun:test';
import { createResourceExecutor } from '../apps/agent/src/tools/resource-executor.ts';
const now = 1000000;
const context = { userId: 'u', runId: 'r', attemptId: 'a', roleId: 'java-backend', deadlineAt: now + 60000 };
const item = { id: 'transactions-guide', roleId: 'java-backend', skillIds: ['transactions'], title: '事务边界指南',
  url: 'https://docs.spring.io/guide', provider: 'Spring', level: 'intermediate', sourceIds: ['spring-transactions'],
  version: '1', reviewStatus: 'reviewed', availability: 'available', verificationStatus: 'content-checked', lastCheckedAt: now - 100 };
const catalog = () => ({ version: 'catalog-v1', allowedHosts: ['docs.spring.io'], items: [{ ...item }] });
const query = { roleId: 'java-backend', skillId: 'transactions', level: 'intermediate', limit: 2 };
const options = { now: () => now, maxAgeMs: 10000 };
test('returns only role, skill and level matched items with actual source/catalog versions', async () => {
  const receipt = await createResourceExecutor(context, catalog(), options)('c1', query);
  expect(receipt.status).toBe('ok'); expect(receipt.data?.catalogVersion).toBe('catalog-v1');
  expect(receipt.data?.items[0]?.id).toBe('transactions-guide'); expect(receipt.sourceIds).toEqual(['spring-transactions']);
  expect((await createResourceExecutor(context, catalog(), options)('c2', { ...query, skillId: 'missing' })).status).toBe('empty');
});
test('requires reviewed, available, checked and fresh resources by default', async () => {
  for (const change of [{ reviewStatus: 'draft' }, { availability: 'unavailable' }, { verificationStatus: 'broken' },
    { lastCheckedAt: null, verificationStatus: 'pending' }, { lastCheckedAt: now - 10001 }, { lastCheckedAt: now + 1 }]) {
    const c = catalog(); Object.assign(c.items[0]!, change);
    expect((await createResourceExecutor(context, c, options)('c', query)).status).toBe('empty');
  }
  const c = catalog(); c.items[0]!.reviewStatus = 'draft';
  expect((await createResourceExecutor(context, c, { ...options, allowDraftResources: true })('c', query)).data?.items[0]?.reviewStatus).toBe('draft');
});
test('rejects model-supplied urls/identity and another role', async () => {
  const run = createResourceExecutor(context, catalog(), options);
  expect((await run('a', { ...query, url: 'https://evil.test' })).error?.code).toBe('VALIDATION_ERROR');
  expect((await run('b', { ...query, userId: 'other' })).error?.code).toBe('VALIDATION_ERROR');
  expect((await run('c', { ...query, roleId: 'web-frontend' })).error?.code).toBe('ROLE_FORBIDDEN');
});
test('rejects host catalog urls outside exact allowlist, credentials, nonhttps and duplicates', () => {
  for (const url of ['http://docs.spring.io/guide','https://docs.spring.io.evil.test/guide','https://u:p@docs.spring.io/guide',
    'https://docs.spring.io:8443/guide','file:///private','not a url']) {
    const c = catalog(); c.items[0]!.url = url;
    expect(() => createResourceExecutor(context, c, options)).toThrow('VALIDATION_ERROR');
  }
  const c = catalog(); c.items.push({ ...c.items[0]! });
  expect(() => createResourceExecutor(context, c, options)).toThrow('VALIDATION_ERROR');
});
test('enforces cancellation, deadline and call budget including empty results', async () => {
  const controller = new AbortController(); controller.abort();
  const run = createResourceExecutor(context, catalog(), { ...options, maxCalls: 1 });
  expect((await run('a', query, controller.signal)).error?.code).toBe('RUN_CANCELLED');
  expect((await run('b', { ...query, skillId: 'missing' })).status).toBe('empty');
  expect((await run('c', query)).error?.code).toBe('TOOL_BUDGET_EXCEEDED');
  expect((await createResourceExecutor({ ...context, deadlineAt: now }, catalog(), options)('a', query)).error?.code).toBe('DEADLINE_EXCEEDED');
});
test('snapshots host configuration and applies deterministic bounded results', async () => {
  const c = catalog(); c.items.push({ ...item, id: 'a-guide' });
  const run = createResourceExecutor(context, c, options); c.items[0]!.title = 'mutated';
  const result = await run('a', { ...query, limit: 1 });
  expect(result.data?.items).toHaveLength(1); expect(result.data?.items[0]?.id).toBe('a-guide');
});
test('does not return records after the lookup crosses its deadline', async () => {
  let reads = 0;
  const run = createResourceExecutor(context,catalog(),{ ...options,now:() => ++reads === 1 ? now : context.deadlineAt });
  expect((await run('a',query)).error?.code).toBe('DEADLINE_EXCEEDED');
});
