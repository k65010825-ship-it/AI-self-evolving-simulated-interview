import { expect, test } from 'bun:test';
import { runDelivery } from '../evals/delivery/runner.ts';
import { qualityIds, scenarioIds } from '../evals/delivery/report.ts';
const manifest = [{ path: 'package.json', sha256: 'a'.repeat(64) }];
test('cancelled execution skips work and never passes', async () => {
  const c = new AbortController(); c.abort();
  const result = await runDelivery({ root: process.cwd(), transport: 'in-process', checks: 'full', signal: c.signal }, {
    sources: async () => manifest, quality: async () => { throw new Error('must not run'); }, scenario: async () => { throw new Error('must not run'); },
  });
  expect(result.report.status).toBe('failed'); expect(result.report.summary.notRun).toBe(qualityIds.length + scenarioIds.length);
});
test('late scenario completion cannot turn a timeout into success', async () => {
  const result = await runDelivery({ root: process.cwd(), transport: 'in-process', checks: 'scenarios-only', stageTimeoutMs: 1 }, {
    sources: async () => manifest,
    scenario: async () => { await new Promise(r => setTimeout(r, 15)); return { checks: [] }; },
  });
  expect(result.report.status).toBe('failed');
  expect(result.report.stages.filter(s => s.error === 'STEP_TIMEOUT')).toHaveLength(7);
  await new Promise(r => setTimeout(r, 20));
  expect(result.files['scenarios.json']).not.toContain('passed');
});
test('scenario failure is isolated and source changes prevent success', async () => {
  let reads = 0, calls = 0;
  const result = await runDelivery({ root: process.cwd(), transport: 'in-process', checks: 'scenarios-only' }, {
    sources: async () => [{ ...manifest[0]!, sha256: (reads++ ? 'b' : 'a').repeat(64) }],
    scenario: async () => { calls++; throw new Error('private-error-not-persisted'); },
  });
  expect(calls).toBe(7); expect(result.report.status).toBe('failed'); expect(result.report.sourceStable).toBe(false);
  expect(JSON.stringify(result)).not.toContain('private-error');
});
