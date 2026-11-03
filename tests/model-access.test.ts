import { test, expect } from 'bun:test';
import offline from '../apps/agent/src/model-access/offline.profile.json' with { type: 'json' };
import planned from '../apps/agent/src/model-access/live-planned.example.json' with { type: 'json' };
import { preflightModelAccess, estimateCostMicros } from '../apps/agent/src/model-access/preflight.ts';

test('preflight validates declarations without inspecting credentials or enabling live execution', () => {
  const a = preflightModelAccess(offline), b = preflightModelAccess(planned);
  expect(a.configValid).toBe(true); expect(a.canExecuteFixture).toBe(true);
  expect(a.canExecuteLive).toBe(false); expect(b.canExecuteLive).toBe(false);
  expect(b.credentialInspection).toBe('not-performed'); expect(b.issues).toContain('LIVE_TRANSPORT_DISABLED');
});
test('invalid/secret-shaped config is rejected with static diagnostics and no echo', () => {
  const bad = { ...offline, apiKey: 'SECRET_SHOULD_NOT_ESCAPE' };
  expect(preflightModelAccess(bad).configValid).toBe(false);
  expect(JSON.stringify(preflightModelAccess(bad))).not.toContain('SECRET_SHOULD_NOT_ESCAPE');
  const p = structuredClone(planned); p.endpoint = 'https://user:secret@example.com/v1?key=SECRET';
  expect(preflightModelAccess(p).configValid).toBe(false);
  const c = structuredClone(offline); c.limits.maxConcurrent = c.limits.maxCalls + 1;
  expect(preflightModelAccess(c).configValid).toBe(false);
});
test('declared token pricing rounds upward once with integer precision', () => {
  expect(estimateCostMicros({ inputMicrosPerMillionTokens: 1, outputMicrosPerMillionTokens: 1 }, 1, 1)).toBe(1);
  expect(estimateCostMicros({ inputMicrosPerMillionTokens: 1000000, outputMicrosPerMillionTokens: 2000000 }, 2, 3)).toBe(8);
  expect(() => estimateCostMicros({ inputMicrosPerMillionTokens: -1, outputMicrosPerMillionTokens: 0 }, 1, 1)).toThrow('MODEL_CONFIG_INVALID');
});
