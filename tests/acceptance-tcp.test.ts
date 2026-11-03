import { test, expect } from 'bun:test';
import { collectSourceManifest } from '../evals/acceptance/artifacts.ts';
import { runAcceptanceSuite } from '../evals/acceptance/run-suite.ts';

test('both role acceptance paths run over real localhost TCP with explicit host-only boundaries', async () => {
  const report = await runAcceptanceSuite({ transport: 'tcp', manifest: await collectSourceManifest(process.cwd()) });
  expect(report.summary).toEqual({ total: 12, passed: 12, failed: 0 });
  expect(report.cases.filter(c => c.transport === 'tcp')).toHaveLength(8);
  expect(report.cases.filter(c => c.transport === 'host')).toHaveLength(4);
}, 30000);
