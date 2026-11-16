import { basename, join, resolve } from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { runReliabilitySuite } from '../evals/reliability/runner.ts';
import { readReliabilityArtifact } from '../evals/reliability/artifacts.ts';
import { renderReliabilityMarkdown } from '../evals/reliability/report.ts';
export function parseReliabilityArgs(args: string[]) {
  if (!args.length) return { mode: 'run' as const };
  if (args.length === 2 && args[0] === '--verify' && basename(args[1]!) === 'report.json') return { mode: 'verify' as const, path: resolve(args[1]!) };
  throw new Error('RELIABILITY_ARGS_INVALID');
}
export async function reliabilityMain(args: string[]) {
  const config = parseReliabilityArgs(args);
  if (config.mode === 'verify') {
    const r = await readReliabilityArtifact(config.path, process.cwd());
    console.log(JSON.stringify({ verified: true, status: r.status, rerun: false, digest: r.digest })); return r.status === 'failed' ? 1 : 0;
  }
  const report = await runReliabilitySuite(process.cwd());
  const cache = join(process.cwd(), '.cache', 'agent-reliability'); await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(join(cache, 'run-')), path = join(dir, 'report.json');
  await writeFile(join(dir, 'report.md'), renderReliabilityMarkdown(report), { flag: 'wx' });
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  await readReliabilityArtifact(path, process.cwd());
  console.log(JSON.stringify({ status: report.status, summary: report.summary, report: path, liveModelCalls: 0, productReady: false }));
  return report.status === 'failed' ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await reliabilityMain(process.argv.slice(2)); }
  catch { console.error('RELIABILITY_EXECUTION_FAILED'); process.exitCode = 2; }
}
