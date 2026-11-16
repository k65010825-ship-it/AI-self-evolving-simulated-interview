import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runReliabilitySuite } from '../evals/reliability/runner.ts';
import { readReliabilityArtifact } from '../evals/reliability/artifacts.ts';
import { parseReliabilityArgs } from '../scripts/agent-reliability.ts';
test('fixed CLI modes and bounded artifacts reject command injection, oversized and malformed data', async () => {
  expect(parseReliabilityArgs([])).toEqual({ mode: 'run' });
  expect(() => parseReliabilityArgs(['--command', 'echo'])).toThrow('RELIABILITY_ARGS_INVALID');
  expect(() => parseReliabilityArgs(['--verify', 'other.json'])).toThrow('RELIABILITY_ARGS_INVALID');
  const dir = await mkdtemp(join(tmpdir(), 'reliability-artifact-')), path = join(dir, 'report.json');
  try {
    await writeFile(path, Buffer.from([0xff])); await expect(readReliabilityArtifact(path, process.cwd())).rejects.toThrow('RELIABILITY_ARTIFACT_INVALID');
    await writeFile(path, 'x'.repeat(4 * 1024 * 1024 + 1)); await expect(readReliabilityArtifact(path, process.cwd())).rejects.toThrow('RELIABILITY_ARTIFACT_INVALID');
    const report = await runReliabilitySuite(process.cwd(), async () => { throw new Error('secret-fixture-detail'); });
    expect(report.summary.failed).toBe(6); expect(JSON.stringify(report)).not.toContain('secret-fixture');
    await writeFile(path, JSON.stringify(report)); expect((await readReliabilityArtifact(path, process.cwd())).digest).toBe(report.digest);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 30000);
