import { test, expect } from 'bun:test';
import { createRunManager } from '../apps/agent/src/runtime/run-manager.ts';
import { reliabilityRequest, assessment, deferred, until } from '../evals/reliability/fixture.ts';
test('shutdown closes admission synchronously, allows grace completion and shares first promise', async () => {
  const gate = deferred<void>(); let entered = false;
  const m = createRunManager({ evaluateForRole: () => async () => { entered = true; await gate.promise; return assessment('隔离甲一'); } });
  m.start(reliabilityRequest('grace')); await until(() => entered);
  const first = m.shutdown({ graceMs: 1000, cancelWaitMs: 100 });
  expect(() => m.start(reliabilityRequest('rejected'))).toThrow('DEPENDENCY_UNAVAILABLE');
  expect(m.shutdown({ graceMs: 0, cancelWaitMs: 0 })).toBe(first);
  gate.resolve(); const result = await first;
  expect(result.status).toBe('drained'); expect(result.cancelledRuns).toBe(0);
  expect(m.snapshot('grace').status).toBe('completed'); expect(result.remaining.occupiedSlots).toBe(0);
});
test('noncooperative dependency remains visible after bounded cancellation, late result stays rejected', async () => {
  const gate = deferred<void>(); let entered = false;
  const m = createRunManager({ evaluateForRole: () => async () => { entered = true; await gate.promise; return assessment('隔离甲一'); } });
  m.start(reliabilityRequest('stubborn')); await until(() => entered);
  const result = await m.shutdown({ graceMs: 0, cancelWaitMs: 5 });
  expect(result.status).toBe('incomplete'); expect(result.cancelledRuns).toBe(1);
  expect(result.remaining.inFlightDependencies).toBe(1); expect(m.snapshot('stubborn').result).toBeNull();
  gate.resolve(); await until(() => m.diagnostics().occupiedSlots === 0);
  expect(result.remaining.inFlightDependencies).toBe(1); expect(m.snapshot('stubborn').result).toBeNull();
});
test('invalid shutdown parameters do not change admission and idle shutdown drains', async () => {
  const m = createRunManager({ evaluateForRole: () => async () => assessment('隔离甲一') });
  expect(() => m.shutdown({ graceMs: -1, cancelWaitMs: 0 })).toThrow('VALIDATION_ERROR');
  m.start(reliabilityRequest('valid')); await m.wait('valid');
  const r = await m.shutdown({ graceMs: 0, cancelWaitMs: 100 }); expect(r.status).toBe('drained');
  expect(m.diagnostics().draining).toBe(true); expect(m.diagnostics().retainedRuns).toBe(1);
});
test('cooperative cancellation exits and a suspended subscriber is reported rather than hidden', async () => {
  let entered = false;
  const m = createRunManager({ evaluateForRole: () => async (_r, signal) => {
    entered = true; await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); return assessment('隔离甲一');
  } });
  m.start(reliabilityRequest('cooperative')); await until(() => entered);
  const iterator = m.events('cooperative'); await iterator.next();
  const result = await m.shutdown({ graceMs: 0, cancelWaitMs: 10 });
  expect(result.status).toBe('incomplete'); expect(result.remaining.inFlightDependencies).toBe(0);
  expect(result.remaining.eventSubscribers).toBe(1); expect(m.snapshot('cooperative').status).toBe('cancelled');
  await iterator.return(undefined); expect(m.diagnostics().eventSubscribers).toBe(0);
});
