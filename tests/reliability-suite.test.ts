import { test, expect } from 'bun:test';
import { runReliabilitySuite } from '../evals/reliability/runner.ts';
import { verifyReliabilityReport } from '../evals/reliability/report.ts';
import { contentHash } from '../evals/answers/validation.ts';
test('fixed offline scenarios isolate users/roles, bound cancellation and preserve restart boundary', async () => {
  const report = await runReliabilitySuite(process.cwd());
  expect(report.status).toBe('passed-offline-checks'); expect(report.summary.passed).toBe(6);
  expect(report.cases.map(c => c.id)).toContain('parallel_isolation'); expect(report.liveModelCalls).toBe(0);
  expect(report.productReady).toBe(false); expect(verifyReliabilityReport(report)).toEqual(report);
  const tampered = structuredClone(report); tampered.cases[0]!.durationMs++;
  expect(() => verifyReliabilityReport(tampered)).toThrow('RELIABILITY_REPORT_INVALID');
  expect(JSON.stringify(report)).not.toContain('userPrompt');
  const forged = structuredClone(report); forged.cases[0]!.metrics!.remainingDependencies = 1;
  const { digest, ...payload } = forged; forged.digest = contentHash(payload);
  expect(() => verifyReliabilityReport(forged)).toThrow('RELIABILITY_REPORT_INVALID');
}, 30000);
