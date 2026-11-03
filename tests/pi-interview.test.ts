import { test, expect } from 'bun:test';
import { runPiInterviewDemo } from '../scripts/demo-pi-interview.ts';
test('both role fixtures flow through actual Pi evaluation, scoring and a distinct next question', async () => {
  for (const role of ['java-backend', 'web-frontend'] as const) {
    const result = await runPiInterviewDemo(role);
    expect(result.liveModelCalls).toBe(0); expect(result.providerCalls).toBe(1); expect(result.committed).toBe(false);
    expect(result.proposal.evaluation.normalizedScore).toBe(0.75);
    expect(result.next.status).toBe('selected');
    if (result.next.status === 'selected') {
      expect(result.next.question.id).not.toBe(result.initial.question.id);
      expect(result.next.question.roleId).toBe(role);
    }
  }
});
