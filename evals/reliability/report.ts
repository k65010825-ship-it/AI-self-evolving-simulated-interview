import { z } from 'zod';
import { DeliveryReportSchema } from '../delivery/report.ts';
import { canonical, contentHash } from '../answers/validation.ts';
import { caseIds, checkLabels } from './scenarios.ts';
const count = z.number().int().min(0).max(100);
const metrics = z.object({ peakDependencies: count, remainingDependencies: count, remainingSlots: count, remainingTimers: count,
  remainingSubscribers: count, retainedRuns: count, providerCalls: count, providerAborts: count }).strict();
const row = z.object({ id: z.enum(caseIds), status: z.enum(['passed', 'failed']), durationMs: z.number().int().min(0).max(120000),
  checks: z.array(z.object({ name: z.string().regex(/^[a-z-]+$/).max(60), passed: z.boolean() }).strict()).max(8).nullable(),
  metrics: metrics.nullable(), error: z.literal('SCENARIO_FAILED').nullable() }).strict();
export const ReliabilityReportSchema = z.object({ version: z.literal(1), suiteId: z.literal('agent-reliability-offline-v1'),
  startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(), sourceManifest: DeliveryReportSchema.shape.sourceManifest, sourceStable: z.boolean(),
  cases: z.array(row).length(caseIds.length), summary: z.object({ total: z.literal(6), passed: count, failed: count }).strict(),
  status: z.enum(['passed-offline-checks', 'failed']), evidenceMode: z.literal('offline-fixture'), transport: z.literal('in-process'),
  liveModelCalls: z.literal(0), productReady: z.literal(false), formalCommitted: z.literal(false),
  persistence: z.literal('memory-only-no-restart-recovery'), capacityClaim: z.literal('synthetic-local-not-production'),
  digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type ReliabilityReport = z.infer<typeof ReliabilityReportSchema>;
export type ReliabilityCase = ReliabilityReport['cases'][number];
function invalid(): never { throw new Error('RELIABILITY_REPORT_INVALID'); }
export function verifyReliabilityReport(raw: unknown): ReliabilityReport {
  const p = ReliabilityReportSchema.safeParse(raw); if (!p.success) invalid(); const r = p.data;
  if (Date.parse(r.finishedAt) < Date.parse(r.startedAt) || r.cases.some((c, i) => c.id !== caseIds[i])) invalid();
  const paths = r.sourceManifest.map(f => f.path);
  if (new Set(paths).size !== paths.length || canonical(paths) !== canonical([...paths].sort())) invalid();
  for (const c of r.cases) {
    if ((c.checks === null) !== (c.metrics === null)) invalid();
    if (c.checks && c.checks.map(check => check.name).join() !== checkLabels[c.id].join()) invalid();
    const passed = c.checks !== null && c.checks.every(check => check.passed);
    if ((c.status === 'passed') !== passed || (passed ? c.error !== null : c.error !== 'SCENARIO_FAILED')) invalid();
    if (passed && c.metrics) {
      const m = c.metrics;
      if (m.remainingDependencies || m.remainingSlots || m.remainingTimers || m.remainingSubscribers) invalid();
      if (m.peakDependencies !== (c.id === 'parallel_isolation' ? 4 : 1)) invalid();
      if (m.providerCalls !== (c.id === 'parallel_isolation' ? 4 : c.id === 'sdk_cancel' ? 1 : 0) || m.providerAborts !== (c.id === 'sdk_cancel' ? 1 : 0)) invalid();
    }
  }
  const passed = r.cases.filter(c => c.status === 'passed').length;
  if (r.summary.passed !== passed || r.summary.failed !== 6 - passed || r.status !== (passed === 6 && r.sourceStable ? 'passed-offline-checks' : 'failed')) invalid();
  const { digest, ...payload } = r; if (contentHash(payload) !== digest) invalid(); return r;
}
export function sealReliabilityReport(input: Pick<ReliabilityReport, 'startedAt' | 'finishedAt' | 'sourceManifest' | 'sourceStable' | 'cases'>) {
  const passed = input.cases.filter(c => c.status === 'passed').length;
  const payload = { ...input, version: 1, suiteId: 'agent-reliability-offline-v1', summary: { total: 6, passed, failed: 6 - passed },
    status: passed === 6 && input.sourceStable ? 'passed-offline-checks' : 'failed', evidenceMode: 'offline-fixture', transport: 'in-process',
    liveModelCalls: 0, productReady: false, formalCommitted: false, persistence: 'memory-only-no-restart-recovery', capacityClaim: 'synthetic-local-not-production' };
  return verifyReliabilityReport({ ...payload, digest: contentHash(payload) });
}
export function renderReliabilityMarkdown(raw: unknown) {
  const r = verifyReliabilityReport(raw);
  return ['# Agent并发隔离与故障恢复离线评测', '', `状态：${r.status}；通过${r.summary.passed}/6；源码稳定：${r.sourceStable}。`, '',
    '实际Pi SDK + 本地确定性provider；真实模型调用0；productReady=false，formalCommitted=false。', '',
    '| 场景 | 状态 | 本地耗时ms | 峰值依赖 | 剩余依赖/槽/计时器/订阅 | 保留任务 |', '| --- | --- | --- | --- | --- | --- |',
    ...r.cases.map(c => `| ${c.id} | ${c.status} | ${c.durationMs} | ${c.metrics?.peakDependencies ?? ''} | ${c.metrics ? [c.metrics.remainingDependencies, c.metrics.remainingSlots, c.metrics.remainingTimers, c.metrics.remainingSubscribers].join('/') : ''} | ${c.metrics?.retainedRuns ?? ''} |`), '',
    ...r.cases.flatMap(c => [`## ${c.id}`, '', ...(c.checks?.map(k => `- ${k.name}：${k.passed ? '通过' : '失败'}`) ?? ['- SCENARIO_FAILED']), '']),
    '计数只观察宿主依赖Promise、编排工作、宿主deadline计时器和事件订阅；不证明SDK内部、网络、OS或供应商资源已释放。',
    '取消后不响应的依赖继续占槽，直到原Promise结束；wait只等业务终态。终态记录占maxRuns，不自动淘汰。',
    '四路本地合成并发不能推导真实模型吞吐/生产容量。新建manager丢失内存历史，不支持服务重启持久恢复。',
    '未验证：真实模型/语音、数据库与正式鉴权、GUI/安装、生产容量/故障恢复。SHA不是签名或独立执行证明。', '', `摘要：${r.digest}`, ''].join('\n');
}
