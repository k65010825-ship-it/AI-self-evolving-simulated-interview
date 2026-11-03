import { test, expect } from 'bun:test';
import { buildAcceptanceCase, sealAcceptanceReport, verifyAcceptanceReport, renderAcceptanceMarkdown, caseIds } from '../evals/acceptance/report.ts';
import { createHash } from 'node:crypto';

const manifest = [{ path: 'package.json', sha256: 'a'.repeat(64) }];
const roles = ['java-backend', 'web-frontend'] as const;
function fixture() {
  const actual = {
    workflow: { completed: true, sdk: true, revisions: '0,1,2,3,4,5,5,5', questionCount: 2, committed: false, liveModelCalls: 0 },
    rsi: { status: 'evaluated_activated_offline', baseline: 0.5, candidate: 1, replayStatus: 'replayed', version: 1, replayVersion: 1, oldDepth: 2, previewDepth: 1, productionPublished: false, liveModelCalls: 0 },
    rollback: { status: 'replayed', activeIsBaseline: true, previewIsBaseline: true, version: 2, appliedNow: false },
    stale: { status: 'failed', code: 'VERSION_CONFLICT', resultIsNull: true, noRsiSuccess: true },
    leakage: { status: 'failed', code: 'VALIDATION_ERROR', resultIsNull: true, noRsiSuccess: true },
    cancellation: { code: 'RUN_CANCELLED', registryUnchanged: true },
  };
  return sealAcceptanceReport({ transport: 'in-process', startedAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString(), manifest,
    cases: roles.flatMap(roleId => caseIds.map(id => buildAcceptanceCase({ id, roleId, transport: id === 'rollback' || id === 'cancellation' ? 'host' : 'in-process', durationMs: 1, actual: actual[id] }))) });
}

test('acceptance report requires complete fixed cases and binds aggregate checks to actual values', () => {
  const report = fixture();
  expect(report.summary).toEqual({ total: 12, passed: 12, failed: 0 });
  expect(verifyAcceptanceReport(report)).toEqual(report);
  expect(renderAcceptanceMarkdown(report)).toContain('仅报告校验不等于场景重跑');
  expect(() => sealAcceptanceReport({ ...report, cases: report.cases.slice(1) })).toThrow('ACCEPTANCE_REPORT_INVALID');
  expect(() => buildAcceptanceCase({ id: 'stale', roleId: 'java-backend', transport: 'host', durationMs: 1, actual: {} })).toThrow('ACCEPTANCE_REPORT_INVALID');
});

test('tampered, duplicate, unknown fields and rehashed false summaries are rejected', () => {
  const report = fixture(), changed = structuredClone(report);
  changed.cases[0]!.checks[0]!.actual = false;
  expect(() => verifyAcceptanceReport(changed)).toThrow('ACCEPTANCE_REPORT_INVALID');
  expect(() => verifyAcceptanceReport({ ...report, rawError: 'private' })).toThrow('ACCEPTANCE_REPORT_INVALID');
  expect(() => sealAcceptanceReport({ ...report, cases: [...report.cases.slice(1), report.cases[1]!] })).toThrow('ACCEPTANCE_REPORT_INVALID');
  expect(() => verifyAcceptanceReport(report, [{ path: 'package.json', sha256: 'b'.repeat(64) }])).toThrow('ACCEPTANCE_SOURCE_CHANGED');
  // The hash is not authentication: even when recalculated, semantic inconsistencies must fail.
  const { digest: _, ...payload } = report;
  payload.summary.passed = 11;
  const canonical = (v: unknown): string => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  const digest = createHash('sha256').update(canonical(payload)).digest('hex');
  expect(() => verifyAcceptanceReport({ ...payload, digest })).toThrow('ACCEPTANCE_REPORT_INVALID');
});

test('a failed assertion remains failed and markdown contains only the preset summary fields', () => {
  const r = fixture();
  r.cases[0]!.checks[0]!.actual = false;
  const failed = sealAcceptanceReport({ ...r, cases: r.cases });
  expect(failed.summary).toEqual({ total: 12, passed: 11, failed: 1 });
  expect(verifyAcceptanceReport(failed).summary.failed).toBe(1);
  expect(renderAcceptanceMarkdown(failed)).toContain('FAIL');
});
