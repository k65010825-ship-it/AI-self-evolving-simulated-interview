import { createHash } from 'node:crypto';
import { z } from 'zod';

export const caseIds = ['workflow', 'rsi', 'rollback', 'stale', 'leakage', 'cancellation'] as const;
export const roles = ['java-backend', 'web-frontend'] as const;
export type CaseId = typeof caseIds[number];
export type Transport = 'tcp' | 'in-process';
export type RoleId = typeof roles[number];
type Value = string | number | boolean | null;
export const expectations: Record<CaseId, Record<string, Value>> = {
  workflow: { completed: true, sdk: true, revisions: '0,1,2,3,4,5,5,5', questionCount: 2, committed: false, liveModelCalls: 0 },
  rsi: { status: 'evaluated_activated_offline', baseline: .5, candidate: 1, replayStatus: 'replayed', version: 1, replayVersion: 1, oldDepth: 2, previewDepth: 1, productionPublished: false, liveModelCalls: 0 },
  rollback: { status: 'replayed', activeIsBaseline: true, previewIsBaseline: true, version: 2, appliedNow: false },
  stale: { status: 'failed', code: 'VERSION_CONFLICT', resultIsNull: true, noRsiSuccess: true },
  leakage: { status: 'failed', code: 'VALIDATION_ERROR', resultIsNull: true, noRsiSuccess: true },
  cancellation: { code: 'RUN_CANCELLED', registryUnchanged: true },
};
const valueSchema = z.union([z.boolean(), z.number().min(0).max(1000000), z.null(),
  z.enum(['0,1,2,3,4,5,5,5', 'evaluated_activated_offline', 'replayed', 'failed', 'completed', 'cancelled',
    'VERSION_CONFLICT', 'VALIDATION_ERROR', 'RUN_CANCELLED'])]);
const manifestSchema = z.array(z.object({
  path: z.string().min(1).max(300).regex(/^[a-zA-Z0-9_./-]+$/).refine(p => !p.startsWith('/') && !p.split('/').some(v => v === '..' || v === '.' || v === '')),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()).min(1).max(3000);
const caseSchema = z.object({ id: z.enum(caseIds), roleId: z.enum(roles), transport: z.enum(['host', 'tcp', 'in-process']),
  durationMs: z.number().int().min(0).max(3600000), error: z.literal('SCENARIO_ERROR').optional(),
  checks: z.array(z.object({ name: z.string().regex(/^[a-zA-Z]+$/), expected: valueSchema, actual: valueSchema }).strict()).min(1).max(20),
}).strict();
const payloadSchema = z.object({
  version: z.literal(1), suiteId: z.literal('agent-offline-acceptance-v1'), evidenceMode: z.literal('offline-fixture'),
  productionPublished: z.literal(false), transport: z.enum(['tcp', 'in-process']),
  startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(), manifest: manifestSchema,
  cases: z.array(caseSchema).length(12), summary: z.object({ total: z.literal(12), passed: z.number().int().min(0).max(12), failed: z.number().int().min(0).max(12) }).strict(),
}).strict();
export const AcceptanceReportSchema = payloadSchema.extend({ digest: z.string().regex(/^[a-f0-9]{64}$/) });
export type AcceptanceCase = z.infer<typeof caseSchema>;
export type AcceptanceReport = z.infer<typeof AcceptanceReportSchema>;
export type SourceManifest = z.infer<typeof manifestSchema>;
function invalid(): never { throw new Error('ACCEPTANCE_REPORT_INVALID'); }
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
}
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
export const casePassed = (c: AcceptanceCase) => !c.error && c.checks.every(k => k.expected === k.actual);
function validateCases(cases: AcceptanceCase[], transport: Transport) {
  let offset = 0;
  for (const role of roles) for (const id of caseIds) {
    const c = cases[offset++];
    if (!c || c.roleId !== role || c.id !== id || c.transport !== (id === 'rollback' || id === 'cancellation' ? 'host' : transport)) invalid();
    const entries = Object.entries(expectations[id]);
    if (c.checks.length !== entries.length) invalid();
    entries.forEach(([name, expected], i) => {
      const check = c.checks[i]!;
      if (check.name !== name || check.expected !== expected || (c.error && check.actual !== null)) invalid();
    });
  }
}
export function buildAcceptanceCase(input: { id: CaseId; roleId: RoleId; transport: AcceptanceCase['transport']; durationMs: number;
  actual: Record<string, Value>; error?: 'SCENARIO_ERROR' }): AcceptanceCase {
  const expected = expectations[input.id];
  if (Object.keys(input.actual).sort().join() !== Object.keys(expected).sort().join()) invalid();
  const parsed = caseSchema.safeParse({ id: input.id, roleId: input.roleId, transport: input.transport, durationMs: input.durationMs,
    ...(input.error ? { error: input.error } : {}), checks: Object.entries(expected).map(([name, value]) => ({ name, expected: value, actual: input.actual[name] })) });
  if (!parsed.success) invalid();
  return parsed.data;
}
export function sealAcceptanceReport(input: { transport: Transport; startedAt: string; finishedAt: string; manifest: SourceManifest; cases: AcceptanceCase[] }): AcceptanceReport {
  const passed = input.cases.filter(casePassed).length;
  const payload = { version: 1, suiteId: 'agent-offline-acceptance-v1', evidenceMode: 'offline-fixture', productionPublished: false,
    transport: input.transport, startedAt: input.startedAt, finishedAt: input.finishedAt, manifest: input.manifest, cases: input.cases,
    summary: { total: 12, passed, failed: input.cases.length - passed } };
  return verifyAcceptanceReport({ ...payload, digest: hash(payload) });
}
/** Integrity and consistency only. SHA256 is not a signature or proof that execution occurred. */
export function verifyAcceptanceReport(raw: unknown, currentManifest?: SourceManifest): AcceptanceReport {
  const parsed = AcceptanceReportSchema.safeParse(raw);
  if (!parsed.success) invalid();
  const r = parsed.data;
  if (Date.parse(r.finishedAt) < Date.parse(r.startedAt)) invalid();
  const paths = r.manifest.map(s => s.path);
  if (new Set(paths).size !== paths.length || paths.join() !== [...paths].sort().join()) invalid();
  validateCases(r.cases, r.transport);
  const passed = r.cases.filter(casePassed).length;
  if (r.summary.passed !== passed || r.summary.failed !== 12 - passed) invalid();
  const { digest, ...payload } = r;
  if (hash(payload) !== digest) invalid();
  if (currentManifest && canonical(currentManifest) !== canonical(r.manifest)) throw new Error('ACCEPTANCE_SOURCE_CHANGED');
  return r;
}
export function renderAcceptanceMarkdown(raw: unknown): string {
  const r = verifyAcceptanceReport(raw);
  const lines = ['# Agent 离线验收报告', '', `套件：${r.suiteId}；传输：${r.transport}；时间：${r.startedAt}—${r.finishedAt}。`, '',
    `案例：${r.summary.passed}/${r.summary.total} 通过；失败 ${r.summary.failed}。`, '',
    '仅报告校验不等于场景重跑；SHA256不是签名，不证明实际执行或可信来源。', '',
    '固定本地模型输出、草案知识与独立手工合成目录；0.5→1仅为合成动作/技能匹配率，不是教学收益。未验证真实模型/ASR、GUI、数据库提交或生产恢复。', '',
    '| 岗位 | 场景 | 调用范围 | 结果 | 耗时ms |', '| --- | --- | --- | --- | --- |'];
  for (const c of r.cases) lines.push(`| ${c.roleId} | ${c.id} | ${c.transport} | ${casePassed(c) ? 'PASS' : 'FAIL'} | ${c.durationMs} |`);
  for (const c of r.cases) {
    lines.push('', `## ${c.roleId} / ${c.id}`, '', ...(c.error ? ['安全错误：SCENARIO_ERROR（不导出原始异常）。', ''] : []));
    for (const k of c.checks) lines.push(`- ${k.name}：预期 ${JSON.stringify(k.expected)}；实际 ${JSON.stringify(k.actual)}。`);
  }
  lines.push('', '## 源码指纹', '', `报告摘要：${r.digest}`, '', ...r.manifest.map(s => `- ${s.path}：${s.sha256}`), '');
  return lines.join('\n');
}
