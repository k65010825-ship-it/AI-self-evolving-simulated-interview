import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonical, contentHash } from '../answers/validation.ts';
export const qualityIds = ['typecheck', 'test', 'pi_offline', 'knowledge_check', 'openapi_lint'] as const;
export const scenarioIds = ['model_preflight', 'knowledge_catalog', 'curated_knowledge', 'budget', 'acceptance', 'answers_development', 'workflow_commit'] as const;
export const stageIds = [...qualityIds, ...scenarioIds, 'source_integrity'] as const;
export type QualityId = typeof qualityIds[number];
export type ScenarioId = typeof scenarioIds[number];
export type StageId = typeof stageIds[number];
export const ArtifactNameSchema = z.enum(['acceptance.json', 'answers-development.json', 'scenarios.json']);
export type ArtifactName = z.infer<typeof ArtifactNameSchema>;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const CountsSchema = z.object({ testsPassed: z.number().int().nonnegative().nullable(), testsFailed: z.number().int().nonnegative().nullable(),
  assertions: z.number().int().nonnegative().nullable(), warnings: z.number().int().nonnegative().nullable() }).strict();
export const StageSchema = z.object({ id: z.enum(stageIds), status: z.enum(['passed', 'failed', 'not_run']), durationMs: z.number().int().min(0).max(600000),
  error: z.enum(['CHECK_FAILED', 'CHECK_TIMEOUT', 'CHECK_CANCELLED', 'CHECK_OUTPUT_LIMIT', 'CHECK_START_FAILED', 'CHECK_SUMMARY_MISSING',
    'STEP_FAILED', 'STEP_TIMEOUT', 'STEP_CANCELLED', 'SOURCE_CHANGED']).nullable(),
  skippedBecause: z.enum(['scenarios-only', 'cancelled']).nullable(), exitCode: z.number().int().min(-1).max(2147483647).nullable(), counts: CountsSchema.nullable() }).strict();
export type DeliveryStage = z.infer<typeof StageSchema>;
const source = z.array(z.object({ path: z.string().min(1).max(300).regex(/^[A-Za-z0-9_./-]+$/).refine(p => !p.startsWith('/') && !p.split('/').some(c => c === '..' || c === '.' || c === '')), sha256: digest }).strict()).min(1).max(5000);
const artifact = z.object({ path: ArtifactNameSchema, sizeBytes: z.number().int().min(1).max(4 * 1024 * 1024), sha256: digest }).strict();
const payload = z.object({ version: z.literal(1), suiteId: z.literal('agent-delivery-offline-v2'), transport: z.enum(['tcp', 'in-process']), checks: z.enum(['full', 'scenarios-only']),
  startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(), sourceManifest: source, sourceStable: z.boolean(),
  runtime: z.object({ bun: z.string().min(1).max(40), node: z.string().min(1).max(40) }).strict(), stages: z.array(StageSchema).length(stageIds.length),
  artifacts: z.array(artifact).max(3), status: z.enum(['passed-offline-checks', 'incomplete', 'failed']),
  summary: z.object({ total: z.literal(stageIds.length), passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), notRun: z.number().int().nonnegative() }).strict(),
  evidenceMode: z.literal('offline-fixture'), productReady: z.literal(false), formalCommitted: z.literal(false), liveModelCalls: z.literal(0),
  notVerified: z.tuple([z.literal('live-model-and-voice'), z.literal('human-reference-and-content-review'), z.literal('database-transactions-and-auth'),
    z.literal('production-deployment')]),
}).strict();
export const DeliveryReportSchema = payload.extend({ digest });
export type DeliveryReport = z.infer<typeof DeliveryReportSchema>;
export const artifactHash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export function invalid(): never { throw new Error('DELIVERY_REPORT_INVALID'); }
function summarize(stages: DeliveryStage[], sourceStable: boolean) {
  const summary = { total: stageIds.length, passed: stages.filter(s => s.status === 'passed').length, failed: stages.filter(s => s.status === 'failed').length,
    notRun: stages.filter(s => s.status === 'not_run').length };
  const status = !sourceStable || summary.failed || stages.some(s => s.skippedBecause === 'cancelled') ? 'failed' as const : summary.notRun ? 'incomplete' as const : 'passed-offline-checks' as const;
  return { summary, status };
}
export function sealDeliveryReport(input: { transport: DeliveryReport['transport']; checks: DeliveryReport['checks']; startedAt: string; finishedAt: string;
  sourceManifest: DeliveryReport['sourceManifest']; sourceStable: boolean; stages: DeliveryStage[]; artifacts: DeliveryReport['artifacts'] }) {
  const p = { ...input, version: 1, suiteId: 'agent-delivery-offline-v2', ...summarize(input.stages, input.sourceStable),
    runtime: { bun: process.versions.bun ?? 'unavailable', node: process.versions.node }, evidenceMode: 'offline-fixture', productReady: false, formalCommitted: false, liveModelCalls: 0,
    notVerified: ['live-model-and-voice', 'human-reference-and-content-review', 'database-transactions-and-auth', 'production-deployment'] };
  return verifyDeliveryReport({ ...p, digest: contentHash(p) });
}
/** Structural arithmetic/integrity only; bundle verifier must additionally read and check every evidence file. */
export function verifyDeliveryReport(raw: unknown): DeliveryReport {
  const p = DeliveryReportSchema.safeParse(raw); if (!p.success) invalid(); const r = p.data;
  if (Date.parse(r.finishedAt) < Date.parse(r.startedAt) || r.stages.some((s, i) => s.id !== stageIds[i])) invalid();
  for (const s of r.stages) {
    const quality = (qualityIds as readonly string[]).includes(s.id);
    if (s.status === 'not_run' ? (!s.skippedBecause || s.error !== null || s.exitCode !== null || s.counts !== null) : (s.skippedBecause !== null || (s.status === 'passed') !== (s.error === null))) invalid();
    if (s.skippedBecause === 'scenarios-only' && (!quality || r.checks !== 'scenarios-only')) invalid();
    if (r.checks === 'scenarios-only' && quality && s.status !== 'not_run') invalid();
    if (quality && s.status === 'passed' && s.exitCode !== 0) invalid();
    if (!quality && (s.exitCode !== null || s.counts !== null)) invalid();
    if (s.id === 'test' && s.status === 'passed' && (!s.counts || !s.counts.testsPassed || s.counts.testsFailed !== 0 || s.counts.assertions === null)) invalid();
  }
  const integrity = r.stages.at(-1)!;
  if (integrity.status !== (r.sourceStable ? 'passed' : 'failed') || integrity.error !== (r.sourceStable ? null : 'SOURCE_CHANGED')) invalid();
  const paths = r.sourceManifest.map(f => f.path);
  if (new Set(paths).size !== paths.length || canonical(paths) !== canonical([...paths].sort())) invalid();
  const names = r.artifacts.map(a => a.path);
  if (new Set(names).size !== names.length || canonical(names) !== canonical([...names].sort()) || !names.includes('scenarios.json')) invalid();
  for (const [id, name] of [['acceptance', 'acceptance.json'], ['answers_development', 'answers-development.json']] as const)
    if (r.stages.find(s => s.id === id)!.status === 'passed' && !names.includes(name)) invalid();
  const computed = summarize(r.stages, r.sourceStable);
  if (canonical(computed.summary) !== canonical(r.summary) || computed.status !== r.status) invalid();
  const { digest: expected, ...body } = r;
  if (contentHash(body) !== expected) invalid();
  return r;
}
export function renderDeliveryMarkdown(raw: unknown) {
  const r = verifyDeliveryReport(raw);
  return ['# Agent统一离线交付报告', '', `状态：${r.status}；检查：${r.checks}；场景传输：${r.transport}。`, '',
    `通过${r.summary.passed}/${r.summary.total}，失败${r.summary.failed}，未运行${r.summary.notRun}；源码前后一致：${r.sourceStable}。`, '',
    '仅离线工程证据；productReady=false、formalCommitted=false、真实模型调用0。跳过六项检查不能当完整验收。', '',
    '| 阶段 | 状态 | 耗时ms | 静态错误/未运行原因 |', '| --- | --- | --- | --- |',
    ...r.stages.map(s => `| ${s.id} | ${s.status} | ${s.durationMs} | ${s.error ?? s.skippedBecause ?? ''} |`), '',
    '## 证据文件', '', ...r.artifacts.map(a => `- [${a.path}](${a.path})：${a.sizeBytes} bytes；SHA256=${a.sha256}`), '',
    '## 未验证', '', ...r.notVerified.map(v => `- ${v}`), '',
    '回答对照仅development草案，不自动运行validation或reserved-final；人工参考和题库批准需单独确认。进程内仅改变场景传输，full模式的bun test仍含TCP测试。', '',
    `报告摘要：${r.digest}。SHA不是签名；校验已有报告不代表重新执行命令、模型或数据库事务。`, ''].join('\n');
}
export function renderHandoff(raw: unknown) {
  const r = verifyDeliveryReport(raw);
  return ['# 给协作者的Agent联调入口', '', `本次状态：${r.status}；同源码校验才可复用，report.json摘要${r.digest}。`, '',
    '1. 使用Bun1.4.4、Node>=24，在对应源码根目录执行bun install --frozen-lockfile --ignore-scripts。',
    '2. bun run agent:delivery执行六检查与离线场景；--scenarios-only --in-process只跑无端口场景，报告必为incomplete。',
    '3. 后端先读docs/agent-client.md与docs/workflow-commit.md；候选需API身份/任务/租约/存储与画像CAS，正式HTTP仍501。',
    '4. 前端先读docs/api.md与docs/prd.md；不要把SDK/模型凭证放进renderer，不把内存演练当正式提交。',
    '5. 真实模型/ASR、人工审核、数据库、GUI/麦克风/安装需独立授权与验收。本命令不部署、不上传、不创建凭证。', '',
    '本目录不包含完整仓库、原始日志或依赖，分享时需另附相同源码；不要提交.cache整目录或个人Obsidian记录。', ''].join('\n');
}
