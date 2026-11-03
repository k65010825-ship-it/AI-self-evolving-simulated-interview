import { test, expect } from 'bun:test';
import { modelAccessMain, runModelBudgetDemo } from '../scripts/model-access.ts';

test('CLI defaults to offline; planned live remains blocked and unsupported options are rejected', async () => {
  expect(await modelAccessMain([])).toBe(0);
  expect(await modelAccessMain(['--planned'])).toBe(1);
  await expect(modelAccessMain(['--env-file', 'arbitrary'])).rejects.toThrow('MODEL_CONFIG_INVALID');
});
test('both role demos show holds, explicit reconciliation and a sticky overrun lock without real model calls', async () => {
  for (const role of ['java-backend', 'web-frontend'] as const) {
    const r = await runModelBudgetDemo(role);
    expect(r.heldUnknown.heldTokens).toBe(140); expect(r.blocked).toBe('MODEL_CONCURRENCY_EXCEEDED');
    expect(r.final.locked).toBe(true); expect(r.final.totals.usedTokens).toBe(225);
    expect(r.final.totals.usedCostMicros).toBe(250); expect(r.liveModelCalls).toBe(0);
  }
});
