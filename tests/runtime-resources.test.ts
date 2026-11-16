import { test, expect } from 'bun:test';
import { createRunManager } from '../apps/agent/src/runtime/run-manager.ts';
import { runtimeRequest } from './helpers/runtime-request.ts';
const output = { evidence: [{ id: 'e', start: 0, end: 4, excerpt: '事务边界' }], criterionScores: [{ criterionId: 'correctness', score: 1, evidenceIds: ['e'] }], feedback: { strengths: ['边界'], improvements: ['恢复'] } };
test('cancelled noncooperative dependency holds its slot until actual promise settlement', async () => {
  let release!: (v: unknown) => void, enter!: () => void;
  const entered = new Promise<void>(r => { enter = r; });
  const manager = createRunManager({ evaluateForRole: () => async () => new Promise(r => { release = r; enter(); }) }, { maxActiveRuns: 1 });
  try {
    manager.start(runtimeRequest()); await entered;
    manager.cancel('run-1', 'attempt-1'); await manager.wait('run-1');
    expect(() => manager.start(runtimeRequest('blocked'))).toThrow('RATE_LIMITED');
    expect(manager.diagnostics().inFlightDependencies).toBe(1);
    release(output); await new Promise(r => setTimeout(r, 0));
    expect(manager.diagnostics().occupiedSlots).toBe(0);
    expect(manager.diagnostics().deadlineTimers).toBe(0);
    expect(manager.snapshot('run-1').result).toBeNull();
  } finally { release?.(output); manager.dispose(); }
});
test('subscriber cleanup and dispose preserve retained-memory boundary', async () => {
  const manager = createRunManager({ evaluateForRole: () => async () => output });
  manager.start(runtimeRequest());
  const controller = new AbortController(), iterator = manager.events('run-1', 0, controller.signal);
  await iterator.next(); expect(manager.diagnostics().eventSubscribers).toBe(1);
  controller.abort(); await iterator.return(undefined); await manager.wait('run-1');
  expect(manager.diagnostics().eventSubscribers).toBe(0);
  expect(manager.diagnostics().deadlineTimers).toBe(0); expect(manager.diagnostics().inFlightDependencies).toBe(0);
  manager.dispose(); expect(manager.diagnostics().disposed).toBe(true); expect(manager.diagnostics().retainedRuns).toBe(1);
});
test('planning dependency also holds a cancelled slot until rejection settles', async () => {
  let release!: () => void, enter!: () => void;
  const entered = new Promise<void>(r => { enter = r; }), gate = new Promise<void>(r => { release = r; });
  const m = createRunManager({ evaluateForRole: () => async () => output,
    planForRole: () => async () => { enter(); await gate; throw new Error('private-late-planner'); } }, { maxActiveRuns: 1 });
  try {
    m.start(runtimeRequest()); await entered; m.cancel('run-1', 'attempt-1'); await m.wait('run-1');
    expect(m.diagnostics().inFlightDependencies).toBe(1);
    expect(() => m.start(runtimeRequest('blocked-plan'))).toThrow('RATE_LIMITED');
    release(); await new Promise(r => setTimeout(r, 0));
    expect(m.diagnostics().occupiedSlots).toBe(0); expect(m.snapshot('run-1').result).toBeNull();
    expect(JSON.stringify(m.snapshot('run-1'))).not.toContain('private-late');
  } finally { release(); m.dispose(); }
});
test('synchronous dependency failure releases counters and queued cancel never calls dependency', async () => {
  let calls = 0;
  const m = createRunManager({ evaluateForRole: () => () => { calls++; throw new Error('private-sync'); } }, { maxActiveRuns: 1 });
  m.start(runtimeRequest()); m.cancel('run-1', 'attempt-1'); await m.wait('run-1');
  expect(calls).toBe(0); expect(m.diagnostics().occupiedSlots).toBe(0);
  m.start(runtimeRequest('sync-failure')); await m.wait('sync-failure');
  expect(calls).toBe(1); expect(m.diagnostics().inFlightDependencies).toBe(0); expect(m.diagnostics().occupiedSlots).toBe(0);
  expect(m.diagnostics().deadlineTimers).toBe(0); m.dispose();
});
