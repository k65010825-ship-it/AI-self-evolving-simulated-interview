import { test, expect } from 'bun:test';
import { runResourcesDemo } from '../scripts/demo-agent-resources.ts';
test('both role reports attach catalog resources with explicit draft and not-started status', async () => {
  for (const role of ['java-backend','web-frontend'] as const) {
    const result = await runResourcesDemo(role);
    expect(result.report.resourceRecommendations.length).toBeGreaterThan(0);
    expect(result.report.resourceRecommendations.every(r => r.resource.roleId === role && r.learningStatus === 'not_started'
      && r.resource.reviewStatus === 'draft')).toBe(true);
    expect(result.report.warnings).toContain('draft_resource_recommendations');
  }
});
