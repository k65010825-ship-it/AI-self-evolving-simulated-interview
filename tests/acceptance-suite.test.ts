import { test, expect } from 'bun:test';
import { runAcceptanceSuite } from '../evals/acceptance/run-suite.ts';
import { verifyAcceptanceReport } from '../evals/acceptance/report.ts';

const manifest = [{ path: 'package.json', sha256: 'a'.repeat(64) }];
test('both roles execute the complete offline acceptance matrix with real in-process SDK and expected failures', async () => {
  const r = await runAcceptanceSuite({ transport: 'in-process', manifest });
  expect(r.summary).toEqual({ total: 12, passed: 12, failed: 0 });
  expect(verifyAcceptanceReport(r).cases).toHaveLength(12);
  expect(r.cases.filter(c => c.transport === 'host')).toHaveLength(4);
  const text = JSON.stringify(r);
  for (const privateKey of ['authorization', 'criterionScores', 'answer-0', 'Bearer', 'baselinePolicy', 'validation-depth-a']) expect(text).not.toContain(privateKey);
}, 30000);

test('unexpected scenario failure is retained with a static error and does not erase later cases', async () => {
  let calls = 0;
  const r = await runAcceptanceSuite({ transport: 'in-process', manifest }, async () => {
    calls++;
    throw new Error('SECRET_TOKEN_private_candidate_answer');
  });
  expect(calls).toBe(12);
  expect(r.summary.failed).toBe(12);
  expect(r.cases.every(c => c.error === 'SCENARIO_ERROR')).toBe(true);
  expect(JSON.stringify(r)).not.toContain('SECRET_TOKEN');
  expect(verifyAcceptanceReport(r).summary.passed).toBe(0);
});
