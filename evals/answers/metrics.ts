import { AnswerRowSchema, AnswerReportSchema, AnswerAnalysisSchema, type AnswerAnalysis, type AnswerRow } from '../../packages/contracts/src/answer-benchmark.ts';
import type { CompiledAnswerDataset } from './dataset.ts';
import { canonical, contentHash } from './validation.ts';
import { z } from 'zod';
const metric = () => ({ sumAbsoluteError: 0, sumSignedError: 0, pairedCount: 0, mae: null as number | null, bias: null as number | null });
type Metric = ReturnType<typeof metric>;
function add(m: Metric, predicted: number, reference: number) { m.sumAbsoluteError += Math.abs(predicted - reference); m.sumSignedError += predicted - reference; m.pairedCount++; }
function finish(m: Metric) { if (m.pairedCount) { m.mae = m.sumAbsoluteError / m.pairedCount; m.bias = m.sumSignedError / m.pairedCount; } return m; }
function invalid(): never { throw new Error('ANSWER_REPORT_INVALID'); }
export function benchmarkSamples(dataset: CompiledAnswerDataset, split: string) {
  if (split !== 'development' && split !== 'validation') throw new Error('ANSWER_SPLIT_FORBIDDEN');
  const samples = dataset.samples.filter(s => s.case.split === split);
  if (!samples.length) invalid();
  return samples;
}
export function analyzeAnswerRows(dataset: CompiledAnswerDataset, split: string, rawRows: unknown): AnswerAnalysis {
  const samples = benchmarkSamples(dataset, split), parsed = z.array(AnswerRowSchema).max(200).safeParse(rawRows);
  if (!parsed.success) invalid();
  const rows = parsed.data;
  if (rows.length !== samples.length || new Set(rows.map(r => r.caseId)).size !== rows.length || rows.some(r => !samples.some(s => s.case.id === r.caseId))) invalid();
  const roles = (['java-backend', 'web-frontend'] as const).map(roleId => {
    const selected = samples.filter(s => s.question.roleId === roleId), criterionError = metric(), weightedError = metric(), dims = new Map<string, Metric>();
    const nullAgreement = { pairedScored: 0, overScored: 0, underScored: 0, bothMissing: 0 };
    let completedCount = 0, fullyScoredCount = 0;
    for (const s of selected) {
      const row = rows.find(r => r.caseId === s.case.id)!;
      if (row.roleId !== roleId || row.questionId !== s.question.id || row.rubricVersion !== s.rubric.version) invalid();
      if (row.status !== 'completed') {
        if ((row.status === 'cancelled') !== (row.error === 'RUN_CANCELLED') || (row.status === 'timed_out') !== (row.error === 'DEADLINE_EXCEEDED')) invalid();
        continue;
      }
      if (row.scores.length !== s.rubric.criteria.length || new Set(row.scores.map(c => c.criterionId)).size !== row.scores.length) invalid();
      completedCount++;
      let predictedWeighted = 0, referenceWeighted = 0, predFull = true, refFull = true;
      for (const c of s.rubric.criteria) {
        const prediction = row.scores.find(d => d.criterionId === c.id), reference = s.reference.assessment.criterionScores.find(d => d.criterionId === c.id)!;
        if (!prediction || (prediction.score !== null && prediction.score > c.maxScore)) invalid();
        const predicted = prediction.score === null ? null : prediction.score / c.maxScore;
        const expected = reference.score === null ? null : reference.score / c.maxScore;
        const dimension = c.dimension!;
        if (!dims.has(dimension)) dims.set(dimension, metric());
        if (predicted === null) predFull = false; else predictedWeighted += predicted * c.weight;
        if (expected === null) refFull = false; else referenceWeighted += expected * c.weight;
        if (predicted !== null && expected !== null) { add(criterionError, predicted, expected); add(dims.get(dimension)!, predicted, expected); nullAgreement.pairedScored++; }
        else if (predicted !== null) nullAgreement.overScored++;
        else if (expected !== null) nullAgreement.underScored++;
        else nullAgreement.bothMissing++;
      }
      if (predFull) fullyScoredCount++;
      // No renormalization over remaining criteria: missing dimensions never become a full score.
      if (predFull && refFull) add(weightedError, predictedWeighted, referenceWeighted);
    }
    return { roleId, totalCount: selected.length, completedCount, failureCount: selected.length - completedCount, fullyScoredCount,
      criterionError: finish(criterionError), weightedError: finish(weightedError),
      dimensions: [...dims].sort(([a], [b]) => a.localeCompare(b)).map(([dimension, m]) => ({ dimension, error: finish(m) })),
      nullAgreement, humanReferenceMae: null };
  });
  return AnswerAnalysisSchema.parse({ comparison: 'draft-reference-descriptive', humanReferenceCount: 0, qualityClaimEligible: false, roles });
}
export function sealAnswerReport(dataset: CompiledAnswerDataset, input: { split: 'development' | 'validation'; rows: AnswerRow[];
  evaluatorId: string; startedAt: string; finishedAt: string }) {
  const payload = { version: 1, datasetId: dataset.id, datasetVersion: dataset.version, datasetDigest: dataset.digest,
    ...input, evaluatorMode: 'offline-fixture', productionPublished: false, analysis: analyzeAnswerRows(dataset, input.split, input.rows) };
  return verifyAnswerReport({ ...payload, digest: contentHash(payload) }, dataset);
}
/** Recompute arithmetic from projections, not inference or semantic evidence. Digest is not authentication. */
export function verifyAnswerReport(raw: unknown, dataset: CompiledAnswerDataset) {
  const p = AnswerReportSchema.safeParse(raw); if (!p.success) invalid();
  const r = p.data;
  if (r.datasetId !== dataset.id || r.datasetVersion !== dataset.version || r.datasetDigest !== dataset.digest || Date.parse(r.finishedAt) < Date.parse(r.startedAt)) invalid();
  const analysis = analyzeAnswerRows(dataset, r.split, r.rows), { digest, ...payload } = r;
  if (canonical(analysis) !== canonical(r.analysis) || contentHash(payload) !== digest) invalid();
  return r;
}
export function renderAnswerMarkdown(raw: unknown, dataset: CompiledAnswerDataset) {
  const r = verifyAnswerReport(raw, dataset);
  const lines = ['# 离线评分草案参考对照', '', `数据：${r.datasetId}/${r.datasetVersion}；split=${r.split}；评估器=${r.evaluatorId}。`, '',
    '全部参考为assistant-authored synthetic-proposed/draft，人工金标准0。结果是草案对照与工程算术，不是模型准确率或教学收益。', '',
    'MAE分母仅包含双方有分的归一化维度；null不转0，失败另计。报告校验只重算投影，SHA不是签名、不证明推理或证据语义。', '',
    '| 岗位 | 请求/完成/失败 | 维度配对数 | 草案MAE | 偏差 | 完整回答配对/加权MAE | 草案缺分但模型给分 | 草案有分但模型缺分 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const role of r.analysis.roles) lines.push(`| ${role.roleId} | ${role.totalCount}/${role.completedCount}/${role.failureCount} | ${role.criterionError.pairedCount} | ${role.criterionError.mae ?? 'null'} | ${role.criterionError.bias ?? 'null'} | ${role.weightedError.pairedCount}/${role.weightedError.mae ?? 'null'} | ${role.nullAgreement.overScored} | ${role.nullAgreement.underScored} |`);
  lines.push('', '## 案例状态', '', ...r.rows.map(row => `- ${row.caseId}：${row.status}${row.status === 'completed' ? '' : ` / ${row.error}`}`), '',
    '## 版本', '', `数据摘要：${r.datasetDigest}`, `报告摘要：${r.digest}`, '',
    '当前未接入真实模型、人类独立标注、同意使用的真人回答、统计充分性或正式评分策略发布。reserved-final未执行。', '');
  return lines.join('\n');
}
