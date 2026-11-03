import { z } from 'zod';
import { ContentReportSchema, ResourceEnrichmentSchema, type ResourceEnrichment } from '../../../../packages/contracts/src/report.ts';
import { ToolContextSchema } from '../../../../packages/contracts/src/tools.ts';
import { AgentStateError } from '../planning/interview-state.ts';
import { createResourceExecutor, ResourceOptionsSchema } from '../tools/resource-executor.ts';
/** Explicit host-side enrichment; neither clicks nor successful lookup are learning completion. */
export async function recommendResources(rawReport: unknown, rawContext: unknown, rawCatalog: unknown, rawOptions: unknown = {}): Promise<ResourceEnrichment> {
  const report = ContentReportSchema.safeParse(rawReport), context = ToolContextSchema.safeParse(rawContext);
  const config = ResourceOptionsSchema.extend({ signal: z.custom<AbortSignal>(v => v instanceof AbortSignal).optional() }).safeParse(rawOptions);
  if (!report.success || !context.success || !config.success) throw new AgentStateError('VALIDATION_ERROR');
  if (context.data.roleId !== report.data.roleId) throw new AgentStateError('ROLE_FORBIDDEN');
  const { signal, ...options } = config.data;
  if (signal?.aborted) throw new AgentStateError('RUN_CANCELLED');
  const now = options.now();
  if (!Number.isSafeInteger(now) || now < 0) throw new AgentStateError('VALIDATION_ERROR');
  if (now >= context.data.deadlineAt) throw new AgentStateError('DEADLINE_EXCEEDED');
  const execute = createResourceExecutor(context.data, rawCatalog, options);
  const recommendations: ResourceEnrichment['report']['resourceRecommendations'] = [];
  const queries: ResourceEnrichment['queries'] = [];
  const warnings = report.data.warnings.filter(w => w !== 'resources_not_integrated'
    && w !== 'draft_resource_recommendations' && !w.startsWith('resource_gap:'));
  const skills = new Set(report.data.skills.map(s => s.skillId));
  if (new Set(report.data.studyPlan.map(p => p.skillId)).size !== report.data.studyPlan.length
    || report.data.studyPlan.some(p => !skills.has(p.skillId))) throw new AgentStateError('VALIDATION_ERROR');
  for (const [index, plan] of report.data.studyPlan.entries()) {
    const level = plan.reason === 'verify_uncertainty' ? 'intermediate' : 'foundational';
    const receipt = await execute(`resource-${index + 1}`, { roleId: report.data.roleId, skillId: plan.skillId, level, limit: 2 }, signal);
    if (signal?.aborted) throw new AgentStateError('RUN_CANCELLED');
    const checkedAt = options.now();
    if (!Number.isSafeInteger(checkedAt) || checkedAt < now) throw new AgentStateError('VALIDATION_ERROR');
    if (checkedAt >= context.data.deadlineAt) throw new AgentStateError('DEADLINE_EXCEEDED');
    if (receipt.status === 'error') throw new AgentStateError(receipt.error!.code);
    queries.push(receipt);
    if (!receipt.data?.items.length) warnings.push(`resource_gap:${plan.skillId}`);
    for (const resource of receipt.data?.items ?? []) recommendations.push({ skillId: plan.skillId, reason: plan.reason,
      explanation: `${plan.label}：${plan.reason === 'assess_unknown' ? '先补充基础材料并做诊断练习' : plan.reason === 'repair_gap' ? '围绕已暴露薄弱点补基础并练习' : '结合材料用不同题复核掌握情况'}。`,
      resource, catalogVersion: receipt.data!.catalogVersion, learningStatus: 'not_started' });
  }
  if (recommendations.some(r => r.resource.reviewStatus === 'draft')) warnings.push('draft_resource_recommendations');
  return ResourceEnrichmentSchema.parse({ report: { ...report.data, resourceRecommendations: recommendations,
    warnings: [...new Set(warnings)] }, queries });
}
