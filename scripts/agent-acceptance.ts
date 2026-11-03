import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectSourceManifest, readAcceptanceReport } from '../evals/acceptance/artifacts.ts';
import { renderAcceptanceMarkdown, verifyAcceptanceReport } from '../evals/acceptance/report.ts';
import { runAcceptanceSuite } from '../evals/acceptance/run-suite.ts';

/** Fixed local output root; no credentials, arbitrary output paths, or executable replay payloads. */
export async function acceptanceMain(args: string[]): Promise<number> {
  if (args[0] === '--verify' && args.length === 2) {
    const report = await readAcceptanceReport(resolve(args[1]!));
    verifyAcceptanceReport(report, await collectSourceManifest(process.cwd()));
    console.log(JSON.stringify({ mode: 'report-validation-only', digest: report.digest, summary: report.summary,
      sourceMatches: true, scenariosReexecuted: false }));
    return report.summary.failed ? 1 : 0;
  }
  if (!(args.length === 0 || (args.length === 1 && args[0] === '--in-process'))) throw new Error('ACCEPTANCE_USAGE');
  const root = process.cwd(), manifest = await collectSourceManifest(root);
  const report = await runAcceptanceSuite({ transport: args.length ? 'in-process' : 'tcp', manifest });
  const outputRoot = join(root, '.cache/agent-acceptance');
  await mkdir(outputRoot, { recursive: true });
  const output = await mkdtemp(join(outputRoot, 'run-'));
  const current = await collectSourceManifest(root);
  if (JSON.stringify(current) !== JSON.stringify(manifest)) {
    await writeFile(join(output, 'source-changed.txt'), 'ACCEPTANCE_SOURCE_CHANGED\n');
    throw new Error('ACCEPTANCE_SOURCE_CHANGED');
  }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(output, 'report.md'), renderAcceptanceMarkdown(report));
  console.log(JSON.stringify({ output, transport: report.transport, summary: report.summary, digest: report.digest,
    evidenceMode: report.evidenceMode, productionPublished: report.productionPublished }));
  return report.summary.failed ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await acceptanceMain(process.argv.slice(2)); }
  catch (e) {
    const allowed = ['ACCEPTANCE_REPORT_INVALID', 'ACCEPTANCE_SOURCE_CHANGED', 'ACCEPTANCE_SOURCE_INVALID', 'ACCEPTANCE_USAGE'];
    console.error(e instanceof Error && allowed.includes(e.message) ? e.message : 'ACCEPTANCE_EXECUTION_FAILED');
    process.exitCode = 1;
  }
}
