import { open, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileAnswerDataset, loadAnswerBundle, getBenchmarkKnowledge } from './dataset.ts';
import { verifyAnswerReport, renderAnswerMarkdown } from './metrics.ts';
import type { CompiledAnswerDataset } from './dataset.ts';

export async function readAnswerReport(path: string, dataset: CompiledAnswerDataset) {
  let file;
  try {
    file = await open(path, 'r');
    const maxBytes = 2 * 1024 * 1024, buffer = Buffer.alloc(maxBytes + 1); let count = 0;
    while (count < buffer.length) { const { bytesRead } = await file.read(buffer, count, buffer.length - count, null); if (!bytesRead) break; count += bytesRead; }
    if (count > maxBytes) throw new Error('oversized');
    return verifyAnswerReport(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count))), dataset);
  } catch { throw new Error('ANSWER_REPORT_INVALID'); }
  finally { await file?.close(); }
}
async function outputDirectory(prefix: string) {
  const root = join(process.cwd(), '.cache/answer-benchmark'); await mkdir(root, { recursive: true });
  return mkdtemp(join(root, prefix));
}
export async function exportAnswerReport(raw: unknown, dataset: CompiledAnswerDataset) {
  const r = verifyAnswerReport(raw, dataset), output = await outputDirectory('run-');
  await writeFile(join(output, 'report.json'), JSON.stringify(r, null, 2) + '\n');
  await writeFile(join(output, 'report.md'), renderAnswerMarkdown(r, dataset));
  return output;
}
export async function exportAnswerReferenceReview() {
  const bundle = loadAnswerBundle(), dataset = compileAnswerDataset(bundle, getBenchmarkKnowledge()), output = await outputDirectory('review-');
  await writeFile(join(output, 'packet.json'), JSON.stringify({ notice: 'Assistant-authored synthetic-proposed draft. No human gold or automatic approval.',
    datasetId: dataset.id, datasetDigest: dataset.digest, manifest: bundle.manifest, samples: dataset.samples }, null, 2) + '\n');
  await writeFile(join(output, 'review.md'), ['# 回答参考审核包', '',
    '18条合成回答和草案参考，人工金标准0。packet包含reserved-final草案，不能称为盲藏最终集。', '',
    '逐题核对岗位/适用版本、题族隔离、引用片段、各锚点评分与信息不足是否应弃分；需独立审核者提出修订，不复制合成标签当人工结果。', '',
    '本命令不生成批准；当前合同仅接收synthetic-proposed/draft。真实人工参考导入需另行明确来源、审核身份、同意使用与契约版本。', ''].join('\n'));
  return { output, totalCount: dataset.samples.length, humanReferenceCount: 0, datasetDigest: dataset.digest };
}
