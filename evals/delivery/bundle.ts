import { open, lstat, realpath, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { canonical } from '../answers/validation.ts';
import { artifactHash, invalid, renderDeliveryMarkdown, renderHandoff, scenarioIds, verifyDeliveryReport, type DeliveryReport } from './report.ts';
import { ScenarioEvidenceSchema, validateChecks, verifyChild } from './scenarios.ts';
import { collectDeliverySources } from './sources.ts';
import type { runDelivery } from './runner.ts';
async function readBounded(dir: string, name: string) {
  const path = join(dir, name);
  if ((await lstat(path)).isSymbolicLink() || dirname(await realpath(path)) !== await realpath(dir)) invalid();
  const handle = await open(path, 'r');
  try {
    if (!(await handle.stat()).isFile()) invalid();
    const buffer = Buffer.alloc(4 * 1024 * 1024 + 1); let count = 0;
    while (count < buffer.length) { const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null); if (!bytesRead) break; count += bytesRead; }
    if (count > 4 * 1024 * 1024) invalid();
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count));
  } finally { await handle.close(); }
}
export async function writeDeliveryBundle(dir: string, result: Awaited<ReturnType<typeof runDelivery>>) {
  // Caller creates a fresh directory; exclusive writes refuse replacing an existing run.
  for (const [name, text] of Object.entries(result.files)) await writeFile(join(dir, name), text, { encoding: 'utf8', flag: 'wx' });
  await writeFile(join(dir, 'report.md'), renderDeliveryMarkdown(result.report), { encoding: 'utf8', flag: 'wx' });
  await writeFile(join(dir, 'handoff.md'), renderHandoff(result.report), { encoding: 'utf8', flag: 'wx' });
  await writeFile(join(dir, 'report.json'), JSON.stringify(result.report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
}
export async function verifyDeliveryBundle(dir: string, sourceRoot: string): Promise<DeliveryReport> {
  try {
    if ((await lstat(dir)).isSymbolicLink()) invalid();
    const r = verifyDeliveryReport(JSON.parse(await readBounded(dir, 'report.json')));
    if (canonical(r.sourceManifest) !== canonical(await collectDeliverySources(sourceRoot))) invalid();
    const expected = [...r.artifacts.map(a => a.path), 'report.json', 'report.md', 'handoff.md'].sort();
    if (canonical((await readdir(dir)).sort()) !== canonical(expected)) invalid();
    const data: Record<string, unknown> = {};
    for (const a of r.artifacts) {
      const text = await readBounded(dir, a.path);
      if (Buffer.byteLength(text) !== a.sizeBytes || artifactHash(text) !== a.sha256) invalid();
      data[a.path] = JSON.parse(text);
    }
    const evidence = ScenarioEvidenceSchema.parse(data['scenarios.json']);
    for (const id of scenarioIds) {
      const stage = r.stages.find(s => s.id === id)!, checks = evidence[id];
      if (checks) {
        validateChecks(id, checks);
        if ((stage.status === 'passed') !== checks.every(c => c.passed) || stage.status === 'not_run') invalid();
      } else if (stage.status === 'passed') invalid();
      if (id === 'acceptance' || id === 'answers_development') {
        const raw = data[id === 'acceptance' ? 'acceptance.json' : 'answers-development.json'];
        if (raw !== undefined) {
          if (!checks) invalid();
          const flags = verifyChild(id, raw, r.sourceManifest, r.transport);
          if (flags.some((flag, i) => flag !== checks[i]?.passed)) invalid();
        } else if (checks) invalid();
      }
    }
    if (await readBounded(dir, 'report.md') !== renderDeliveryMarkdown(r) || await readBounded(dir, 'handoff.md') !== renderHandoff(r)) invalid();
    return r;
  } catch { throw new Error('DELIVERY_BUNDLE_INVALID'); }
}
