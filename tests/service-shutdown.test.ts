import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { createRunManager } from '../apps/agent/src/runtime/run-manager.ts';
import { createServiceShutdown, bindShutdownSignals } from '../apps/agent/src/runtime/service-shutdown.ts';
import { reliabilityRequest } from '../evals/reliability/fixture.ts';
test('repeated signals share shutdown and close transport exactly once', async () => {
  const m = createRunManager({ evaluateForRole: () => async () => { throw new Error('unused'); } });
  let stops = 0, reports = 0; const signals = new EventEmitter();
  const shutdown = createServiceShutdown({ runtime: m, stop: async () => { stops++; } }, { graceMs: 0, cancelWaitMs: 20 });
  const detach = bindShutdownSignals(signals, shutdown, () => { reports++; }, () => { throw new Error('unexpected failure'); });
  signals.emit('SIGTERM'); signals.emit('SIGINT');
  expect(() => m.start(reliabilityRequest('after-signal'))).toThrow('DEPENDENCY_UNAVAILABLE');
  const result = await shutdown(); await Promise.resolve();
  expect(result.status).toBe('stopped'); expect(result.transport).toBe('closed'); expect(stops).toBe(1); expect(reports).toBe(1);
  detach(); expect(signals.listenerCount('SIGTERM')).toBe(0); expect(signals.listenerCount('SIGINT')).toBe(0);
});
test('transport timeout and rejection are static incomplete results', async () => {
  const timed = createServiceShutdown({ stop: () => new Promise<void>(() => {}) }, { transportWaitMs: 1 });
  expect((await timed()).transport).toBe('timed_out'); expect((await timed()).status).toBe('incomplete');
  const failed = await createServiceShutdown({ stop: () => { throw new Error('private-stop-detail'); } })();
  expect(failed.transport).toBe('failed'); expect(failed.status).toBe('incomplete'); expect(JSON.stringify(failed)).not.toContain('private-stop');
});
test('runtime error still closes transport without leaking its exception', async () => {
  let stops = 0;
  const r = await createServiceShutdown({ runtime: { shutdown: () => { throw new Error('private-runtime'); } }, stop: () => { stops++; } })();
  expect(r.runtimeState).toBe('failed'); expect(r.status).toBe('incomplete'); expect(stops).toBe(1);
  expect(JSON.stringify(r)).not.toContain('private-runtime');
});
