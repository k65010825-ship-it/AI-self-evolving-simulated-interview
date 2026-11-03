import { test, expect } from 'bun:test';
import { runAgentRuntimeDemo } from '../scripts/demo-agent-runtime.ts';
for (const roleId of ['java-backend', 'web-frontend'] as const) {
  test(`local TCP runtime runs ${roleId} turn and report through real Pi fixture`, async () => {
    const demo = await runAgentRuntimeDemo(roleId);
    expect(demo.turnStatus).toBe('completed');
    expect(demo.reportStatus).toBe('completed');
    expect(demo.liveModelCalls).toBe(0);
    expect(demo.committed).toBe(false);
    expect(demo.eventTypes.at(-1)).toBe('run.completed');
    expect(demo.eventSequences).toEqual(demo.eventSequences.map((_, index) => index + 1));
  });
}
