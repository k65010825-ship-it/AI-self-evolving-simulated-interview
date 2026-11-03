import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectSourceManifest, readAcceptanceReport } from '../evals/acceptance/artifacts.ts';
import { runAcceptanceSuite } from '../evals/acceptance/run-suite.ts';
import { verifyAcceptanceReport } from '../evals/acceptance/report.ts';

test('source manifest hashes only the declared code/data roots and detects changes deterministically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'acceptance-manifest-'));
  try {
    for (const p of ['apps/agent/src', 'packages/contracts/src', 'packages/interview-domain/src', 'packages/agent-client/src', 'experiments', 'evals', 'scripts', 'knowledge']) await mkdir(join(root, p), { recursive: true });
    for (const p of ['package.json', 'bun.lock', 'tsconfig.json', 'apps/agent/src/example.ts', 'apps/agent/package.json',
      'packages/contracts/package.json', 'packages/interview-domain/package.json', 'packages/agent-client/package.json']) await writeFile(join(root, p), '{}');
    await writeFile(join(root, '.env'), 'PRIVATE_SECRET');
    const a = await collectSourceManifest(root);
    const report = await runAcceptanceSuite({ transport: 'in-process', manifest: a }, async () => { throw new Error('fixture'); });
    expect(a.map(v => v.path)).not.toContain('.env');
    expect(await collectSourceManifest(root)).toEqual(a);
    await writeFile(join(root, 'packages/agent-client/package.json'), '{"exports":"./alternate.ts"}');
    expect(await collectSourceManifest(root)).not.toEqual(a);
    const changed = await collectSourceManifest(root);
    expect(() => verifyAcceptanceReport(report, changed)).toThrow('ACCEPTANCE_SOURCE_CHANGED');
    await writeFile(join(root, 'packages/agent-client/package.json'), '{}');
    await writeFile(join(root, 'apps/agent/src/example.ts'), 'changed');
    expect(await collectSourceManifest(root)).not.toEqual(a);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('report reader rejects oversized or non-report data without exposing its contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'acceptance-reader-'));
  try {
    const path = join(root, 'report.json');
    await writeFile(path, 'PRIVATE_SECRET');
    await expect(readAcceptanceReport(path)).rejects.toThrow('ACCEPTANCE_REPORT_INVALID');
    await writeFile(path, ' '.repeat(2 * 1024 * 1024 + 1));
    await expect(readAcceptanceReport(path)).rejects.toThrow('ACCEPTANCE_REPORT_INVALID');
  } finally { await rm(root, { recursive: true, force: true }); }
});
