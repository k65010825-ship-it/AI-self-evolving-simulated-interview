import { test, expect } from 'bun:test';
import { runShutdownDemo } from '../scripts/demo-shutdown.ts';
test('in-process runtime/client/HTTP/SSE shutdown cancels both roles and stops admission', async () => {
  for (const role of ['java-backend', 'web-frontend'] as const) {
    const r = await runShutdownDemo(role, 'in-process');
    expect(r.service.status).toBe('stopped'); expect(r.service.runtime?.status).toBe('drained');
    expect(r.runStatus).toBe('cancelled'); expect(r.newRunError).toBe('DEPENDENCY_UNAVAILABLE'); expect(r.liveModelCalls).toBe(0);
  }
});
