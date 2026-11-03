import { expect, test } from 'bun:test';
import { runReportDemo } from '../scripts/demo-agent-report.ts';
import { recommendResources } from '../apps/agent/src/reporting/recommend-resources.ts';
import { createPiResourceTool } from '../apps/agent/src/tools/pi-resource-tool.ts';
async function fixture() {
  const report = await runReportDemo(); const now = report.generatedAt;
  const context = { userId: 'demo', runId: 'resources', attemptId: 'a', roleId: 'java-backend', deadlineAt: now + 60000 };
  const catalog = { version: 'catalog-v1', allowedHosts: ['docs.spring.io'], items: [{ id: 'tx', roleId: 'java-backend',
    skillIds: ['spring-transactions'], title: '事务学习', url: 'https://docs.spring.io/guide', provider: 'Spring',
    level: 'intermediate', sourceIds: ['spring-transactions'], version: '1', reviewStatus: 'reviewed', availability: 'available',
    verificationStatus: 'content-checked', lastCheckedAt: now - 100 }] };
  return { report, context, catalog, options: { now: () => now } };
}
test('enriches the report using actual catalog receipts, reasons and not-started learning status', async () => {
  const { report,context,catalog,options } = await fixture(); const before = JSON.stringify(report);
  const result = await recommendResources(report,context,catalog,options);
  expect(result.report.resourceRecommendations).toHaveLength(1);
  const recommendation = result.report.resourceRecommendations[0];
  if (!recommendation) throw new Error('Expected recommendation');
  expect(recommendation.resource.id).toBe('tx'); expect(recommendation.catalogVersion).toBe('catalog-v1');
  expect(recommendation.reason).toBe('verify_uncertainty'); expect(recommendation.learningStatus).toBe('not_started');
  expect(result.queries.some(q => q.status === 'empty')).toBe(true);
  expect(result.report.warnings).toContain('resource_gap:java-concurrency');
  expect(JSON.stringify(report)).toBe(before);
});
test('default draft exclusion produces gaps and explicit development opt-in preserves draft state', async () => {
  const f = await fixture(); f.catalog.items[0]!.reviewStatus = 'draft';
  expect((await recommendResources(f.report,f.context,f.catalog,f.options)).report.resourceRecommendations).toHaveLength(0);
  const result = await recommendResources(f.report,f.context,f.catalog,{ ...f.options,allowDraftResources:true });
  expect(result.report.resourceRecommendations[0]?.resource.reviewStatus).toBe('draft');
  expect(result.report.warnings).toContain('draft_resource_recommendations');
});
test('resource attachment cannot bypass role, budget or cancellation', async () => {
  const f = await fixture();
  await expect(recommendResources(f.report,{ ...f.context,roleId:'web-frontend' },f.catalog,f.options)).rejects.toThrow('ROLE_FORBIDDEN');
  await expect(recommendResources(f.report,f.context,f.catalog,{ ...f.options,maxCalls:0 })).rejects.toThrow('TOOL_BUDGET_EXCEEDED');
  const controller = new AbortController(); controller.abort();
  await expect(recommendResources(f.report,f.context,f.catalog,{ ...f.options,signal:controller.signal })).rejects.toThrow('RUN_CANCELLED');
});
test('Pi resource wrapper revalidates raw model parameters and returns the actual receipt', async () => {
  const f = await fixture(); const tool = createPiResourceTool(f.context,f.catalog,f.options);
  const sdkContext = {} as Parameters<typeof tool.execute>[4];
  const result = await tool.execute('a',{ roleId:'java-backend',skillId:'spring-transactions',level:'intermediate' },undefined,undefined,sdkContext);
  expect(JSON.parse((result.content[0] as {text:string}).text).data.items[0].id).toBe('tx');
  const invalid = await tool.execute('b',{ roleId:'java-backend',skillId:'spring-transactions',level:'intermediate',url:'https://evil.test' },undefined,undefined,sdkContext);
  expect(JSON.parse((invalid.content[0] as {text:string}).text).error.code).toBe('VALIDATION_ERROR');
});
test('cancellation delivered while awaiting the last receipt prevents report enrichment', async () => {
  const f = await fixture(); f.report.studyPlan = f.report.studyPlan.filter(p => p.skillId === 'spring-transactions');
  const controller = new AbortController();
  await expect(recommendResources(f.report,f.context,f.catalog,{ ...f.options,signal:controller.signal,
    now:() => { queueMicrotask(() => controller.abort()); return f.report.generatedAt; } }))
    .rejects.toThrow('RUN_CANCELLED');
});
