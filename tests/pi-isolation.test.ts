import { expect, test } from 'bun:test';
import { runOfflineSpike } from '../experiments/pi-sdk/offline-spike.ts';
test('real Pi dispatches only the authorized seed tool and settles a cancelled local stream', async () => {
  const report = await runOfflineSpike();
  expect(report.liveModelCalls).toBe(0);
  expect(report.toolCalls).toBe(1);
  expect(report.toolIsolation).toBe(true);
  expect(report.sdkHistoryRestored).toBe(true);
  expect(report.cancellation).toBe(true);
}, 30000);
