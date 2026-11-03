import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptanceMain } from '../scripts/agent-acceptance.ts';
import { collectSourceManifest } from '../evals/acceptance/artifacts.ts';
import { runAcceptanceSuite } from '../evals/acceptance/run-suite.ts';

test('verification of an intact failed report stays unsuccessful, and invalid CLI options do no work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'acceptance-cli-'));
  try {
    const report = await runAcceptanceSuite({ transport: 'in-process', manifest: await collectSourceManifest(process.cwd()) }, async () => { throw new Error('Private'); });
    const file = join(root, 'report.json');
    await writeFile(file, JSON.stringify(report));
    expect(await acceptanceMain(['--verify', file])).toBe(1);
    await expect(acceptanceMain(['--output', 'unexpected'])).rejects.toThrow('ACCEPTANCE_USAGE');
    await expect(acceptanceMain(['--verify'])).rejects.toThrow('ACCEPTANCE_USAGE');
  } finally { await rm(root, { recursive: true, force: true }); }
});
