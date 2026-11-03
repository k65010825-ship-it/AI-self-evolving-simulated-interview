import { expect, test } from 'bun:test';
import { commands, parseCounts, runQuality } from '../evals/delivery/quality.ts';
test('quality commands are fixed and Bun summary parsing fails closed', () => {
  expect(commands.test).toEqual(['test']);
  expect(parseCounts('test', '3 pass\n0 fail\n4 expect() calls')).toEqual({ testsPassed: 3, testsFailed: 0, assertions: 4, warnings: null });
  expect(parseCounts('test', 'secret unexpected failure')?.testsPassed).toBeNull();
  expect(parseCounts('typecheck', '3 pass\n0 fail')).toBeNull();
});
test('actual fixed child start failure and timeout return static failures without output', async () => {
  const missing = await runQuality('typecheck', `${process.cwd()}/.cache/not-a-real-directory`);
  expect(missing.status).toBe('failed'); expect(missing.error).toBe('CHECK_START_FAILED');
  const timed = await runQuality('typecheck', process.cwd(), undefined, 1);
  expect(timed.status).toBe('failed'); expect(timed.error).toBe('CHECK_TIMEOUT');
  expect(Object.keys(timed)).not.toContain('stdout'); expect(Object.keys(timed)).not.toContain('stderr');
});
