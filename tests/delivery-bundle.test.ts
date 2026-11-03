import { expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDelivery } from '../evals/delivery/runner.ts';
import { writeDeliveryBundle, verifyDeliveryBundle } from '../evals/delivery/bundle.ts';
test('actual in-process scenarios produce an incomplete, verifiable bundle; corrupt child is rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-delivery-'));
  try {
    const result = await runDelivery({ root: process.cwd(), transport: 'in-process', checks: 'scenarios-only' });
    expect(result.report.status).toBe('incomplete'); expect(result.report.summary.failed).toBe(0); expect(result.report.summary.passed).toBe(8);
    await writeDeliveryBundle(dir, result);
    expect((await verifyDeliveryBundle(dir, process.cwd())).digest).toBe(result.report.digest);
    const text = await readFile(join(dir, 'scenarios.json'), 'utf8');
    expect(text).not.toContain('question');
    await writeFile(join(dir, 'scenarios.json'), '{}');
    await expect(verifyDeliveryBundle(dir, process.cwd())).rejects.toThrow('DELIVERY_BUNDLE_INVALID');
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 30000);
