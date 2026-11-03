import type { AgentRunRequest, AgentRunSnapshot, AgentRunEvent } from '../../../../packages/contracts/src/agent-run.ts';
/** Internal candidate execution only; formal commit belongs to the business API. */
export interface InterviewBackend {
  start(input: AgentRunRequest): AgentRunSnapshot;
  snapshot(runId: string): AgentRunSnapshot;
  events(runId: string, afterSeq?: number, signal?: AbortSignal): AsyncIterable<AgentRunEvent>;
  cancel(runId: string, attemptId: string): AgentRunSnapshot;
}
