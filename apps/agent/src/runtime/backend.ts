import type { RunEvent } from '../../../../packages/contracts/src/events.ts';
export interface InterviewBackend {
  start(input: { runId: string; attemptId: string; inputSnapshotId: string }, signal: AbortSignal): AsyncIterable<RunEvent>;
  cancel(runId: string, attemptId: string): Promise<void>;
}
// Interface only: no real model run is exposed by this scaffold.
