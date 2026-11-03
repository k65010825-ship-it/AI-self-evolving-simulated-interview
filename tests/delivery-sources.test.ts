import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectDeliverySources } from '../evals/delivery/sources.ts';
test('test configuration is fingerprinted and hidden credential files are excluded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'delivery-sources-'));
  try {
    for (const name of ['apps', 'packages', 'tests', 'scripts', 'experiments', 'evals', 'knowledge', 'docs']) await mkdir(join(dir, name));
    for (const name of ['package.json', 'bun.lock', 'bunfig.toml', 'tsconfig.json', 'README.md', 'AGENTS.md']) await writeFile(join(dir, name), 'fixture');
    await writeFile(join(dir, 'apps', '.env'), 'not-a-real-secret');
    const before = await collectDeliverySources(dir);
    expect(before.map(f => f.path)).toContain('bunfig.toml'); expect(before.some(f => f.path.endsWith('.env'))).toBe(false);
    await writeFile(join(dir, 'bunfig.toml'), '[test]\nroot="empty"');
    const after = await collectDeliverySources(dir);
    expect(before.find(f => f.path === 'bunfig.toml')?.sha256).not.toBe(after.find(f => f.path === 'bunfig.toml')?.sha256);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
