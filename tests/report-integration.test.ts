import { test, expect } from 'bun:test';
import { runReportDemo } from '../scripts/demo-agent-report.ts';
test('both role reports preserve local SDK provenance and uncovered skills', async () => {
  for (const role of ['java-backend','web-frontend'] as const) {
    const report = await runReportDemo(role);
    expect(report.roleId).toBe(role); expect(report.evidenceMode).toBe('offline-fixture');
    expect(report.coverage.observedSkills).toBe(1); expect(report.coverage.totalSkills).toBe(2);
    expect(report.assessments[0]?.evaluation.normalizedScore).toBe(0.75);
    expect(report.expression.status).toBe('not_evaluated');
  }
});
