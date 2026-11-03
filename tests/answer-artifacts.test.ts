import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileAnswerDataset, loadAnswerBundle, getBenchmarkKnowledge } from '../evals/answers/dataset.ts';
import { runAnswerBenchmark } from '../evals/answers/runner.ts';
import { readAnswerReport, exportAnswerReport, exportAnswerReferenceReview } from '../evals/answers/artifacts.ts';
import { answerBenchmarkMain } from '../scripts/answer-benchmark.ts';

test('safe report artifacts round-trip and failed execution remains unsuccessful under CLI verification', async () => {
  const r = await runAnswerBenchmark(loadAnswerBundle(), getBenchmarkKnowledge(), { split: 'development', evaluatorId: 'failed-fixture', evaluate: async () => { throw new Error('private'); } });
  const dataset = compileAnswerDataset(loadAnswerBundle(), getBenchmarkKnowledge()), output = await exportAnswerReport(r, dataset);
  const path = join(output, 'report.json');
  expect(await readAnswerReport(path, dataset)).toEqual(r);
  expect(await answerBenchmarkMain(['--verify', path])).toBe(1);
  const markdown = await readFile(join(output, 'report.md'), 'utf8');
  expect(markdown).toContain('人工金标准0');
  expect(markdown).not.toContain('private');
  const packet = await exportAnswerReferenceReview();
  expect(packet.totalCount).toBe(18);
  expect(packet.humanReferenceCount).toBe(0);
});

test('oversized/invalid files and unsupported CLI arguments fail without inference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'answer-reader-')), path = join(root, 'report.json');
  const dataset = compileAnswerDataset(loadAnswerBundle(), getBenchmarkKnowledge());
  try {
    await writeFile(path, 'RAW_PRIVATE');
    await expect(readAnswerReport(path, dataset)).rejects.toThrow('ANSWER_REPORT_INVALID');
    await writeFile(path, ' '.repeat(2 * 1024 * 1024 + 1));
    await expect(readAnswerReport(path, dataset)).rejects.toThrow('ANSWER_REPORT_INVALID');
    await expect(answerBenchmarkMain(['--split', 'reserved-final'])).rejects.toThrow('ANSWER_SPLIT_FORBIDDEN');
    await expect(answerBenchmarkMain(['--output', 'arbitrary'])).rejects.toThrow('ANSWER_BENCHMARK_USAGE');
    await expect(answerBenchmarkMain(['--verify'])).rejects.toThrow('ANSWER_BENCHMARK_USAGE');
  } finally { await rm(root, { recursive: true, force: true }); }
});
