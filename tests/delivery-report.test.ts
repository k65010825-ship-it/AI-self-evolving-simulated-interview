import { test, expect } from 'bun:test';
import { sealDeliveryReport, verifyDeliveryReport, stageIds, qualityIds } from '../evals/delivery/report.ts';

function fixture() {
  return { transport: 'in-process' as const, checks: 'full' as const, startedAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString(),
    sourceManifest: [{ path: 'package.json', sha256: 'a'.repeat(64) }], sourceStable: true,
    stages: stageIds.map(id => ({ id, status: 'passed' as const, durationMs: 1, error: null, skippedBecause: null,
      exitCode: qualityIds.includes(id as typeof qualityIds[number]) ? 0 : null,
      counts: id === 'test' ? { testsPassed: 3, testsFailed: 0, assertions: 4, warnings: null } : null })),
    artifacts: (['acceptance.json', 'answers-development.json', 'scenarios.json'] as const).map(path => ({ path, sizeBytes: 2, sha256: 'b'.repeat(64) })) };
}
test('complete fixed stages aggregate only into offline success, never product readiness', () => {
  const r = sealDeliveryReport(fixture());
  expect(r.status).toBe('passed-offline-checks'); expect(r.productReady).toBe(false); expect(r.formalCommitted).toBe(false);
  expect(verifyDeliveryReport(r)).toEqual(r);
});
test('skipping quality checks remains incomplete, and failed/source-changed reports cannot pass', () => {
  const f = fixture(), skipped = f.stages.map(s => qualityIds.includes(s.id as typeof qualityIds[number]) ? { ...s, status: 'not_run' as const, skippedBecause: 'scenarios-only' as const, exitCode: null, counts: null } : s);
  expect(sealDeliveryReport({ ...f, checks: 'scenarios-only', stages: skipped }).status).toBe('incomplete');
  const failed = f.stages.map((s, i) => i ? s : { ...s, status: 'failed' as const, error: 'CHECK_FAILED' as const, exitCode: 1 });
  expect(sealDeliveryReport({ ...f, stages: failed }).status).toBe('failed');
  const sourceChanged = f.stages.map(s => s.id === 'source_integrity' ? { ...s, status: 'failed' as const, error: 'SOURCE_CHANGED' as const } : s);
  expect(sealDeliveryReport({ ...f, sourceStable: false, stages: sourceChanged }).status).toBe('failed');
});
test('missing/duplicate stages, false success and tampering are rejected', () => {
  const f = fixture();
  expect(() => sealDeliveryReport({ ...f, stages: f.stages.slice(1) })).toThrow('DELIVERY_REPORT_INVALID');
  expect(() => sealDeliveryReport({ ...f, stages: [...f.stages.slice(1), f.stages[1]!] })).toThrow('DELIVERY_REPORT_INVALID');
  const r = sealDeliveryReport(f); r.stages[0]!.durationMs++;
  expect(() => verifyDeliveryReport(r)).toThrow('DELIVERY_REPORT_INVALID');
  const bad = fixture(); bad.stages.find(s => s.id === 'test')!.counts!.testsPassed = 0;
  expect(() => sealDeliveryReport(bad)).toThrow('DELIVERY_REPORT_INVALID');
});
