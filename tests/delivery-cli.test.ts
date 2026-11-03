import { expect, test } from 'bun:test';
import { parseDeliveryArgs } from '../scripts/agent-delivery.ts';
test('delivery CLI accepts only fixed modes and explicit report filenames', () => {
  expect(parseDeliveryArgs([])).toEqual({ transport: 'tcp', checks: 'full' });
  expect(parseDeliveryArgs(['--scenarios-only', '--in-process'])).toEqual({ transport: 'in-process', checks: 'scenarios-only' });
  for (const args of [['--command', 'echo'], ['--verify', 'other.json'], ['--in-process', '--in-process'], ['--verify', 'report.json', '--in-process']]) {
    expect(() => parseDeliveryArgs(args)).toThrow('DELIVERY_ARGS_INVALID');
  }
});
