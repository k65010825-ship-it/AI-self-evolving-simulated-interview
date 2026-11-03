import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { runOfflineAnswerBenchmark } from '../evals/answers/runner.ts';
import { compileAnswerDataset, loadAnswerBundle, getBenchmarkKnowledge } from '../evals/answers/dataset.ts';
import { exportAnswerReferenceReview, exportAnswerReport, readAnswerReport } from '../evals/answers/artifacts.ts';

export async function answerBenchmarkMain(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === '--review') { console.log(JSON.stringify(await exportAnswerReferenceReview())); return 0; }
  if (args.length === 2 && args[0] === '--verify') {
    const dataset = compileAnswerDataset(loadAnswerBundle(), getBenchmarkKnowledge()), r = await readAnswerReport(resolve(args[1]!), dataset);
    console.log(JSON.stringify({ mode: 'report-arithmetic-only', datasetMatches: true, inferenceReexecuted: false, humanReferenceCount: 0 }));
    return r.analysis.roles.some(role => role.failureCount) ? 1 : 0;
  }
  if (args[0] === '--split' && args[1] === 'reserved-final') throw new Error('ANSWER_SPLIT_FORBIDDEN');
  if (!(args.length === 0 || (args.length === 2 && args[0] === '--split' && ['development', 'validation'].includes(args[1]!)))) throw new Error('ANSWER_BENCHMARK_USAGE');
  const split = args[1] === 'validation' ? 'validation' : 'development';
  const report = await runOfflineAnswerBenchmark(split), dataset = compileAnswerDataset(loadAnswerBundle(), getBenchmarkKnowledge());
  const output = await exportAnswerReport(report, dataset);
  console.log(JSON.stringify({ output, split, rows: report.rows.length, roles: report.analysis.roles, evaluatorMode: report.evaluatorMode,
    comparison: report.analysis.comparison, humanReferenceCount: 0, qualityClaimEligible: false, liveModelCalls: 0, productionPublished: false }));
  return report.analysis.roles.some(role => role.failureCount) ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await answerBenchmarkMain(process.argv.slice(2)); }
  catch (e) {
    const codes = ['ANSWER_SPLIT_FORBIDDEN', 'ANSWER_BENCHMARK_USAGE', 'ANSWER_REPORT_INVALID', 'ANSWER_DATASET_STALE', 'ANSWER_DATASET_INVALID', 'ANSWER_BENCHMARK_INVALID'];
    console.error(e instanceof Error && codes.includes(e.message) ? e.message : 'ANSWER_BENCHMARK_FAILED'); process.exitCode = 1;
  }
}
