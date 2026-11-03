import { test, expect } from 'bun:test';
import { runWorkflowCommitDemo } from '../scripts/demo-workflow-commit.ts';
for (const transport of ['in-process', 'tcp'] as const) test(`both roles execute SDK workflow admission and CAS fixture over ${transport}`, async () => {
  for (const role of ['java-backend', 'web-frontend'] as const) {
    const r = await runWorkflowCommitDemo(role, transport);
    expect(r.revisionHistory).toEqual([0, 1, 2, 3, 4, 5, 5, 5]);
    expect(r.storageVersionHistory).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(r.raceError).toBe('COMMIT_VERSION_CONFLICT'); expect(r.receiptCount).toBe(8);
    expect(r.memoryVersion).toBe(1); expect(r.lostAck).toBe('replayed-in-memory');
    expect(r.formalCommitted).toBe(false); expect(r.liveModelCalls).toBe(0);
  }
}, 30000);
