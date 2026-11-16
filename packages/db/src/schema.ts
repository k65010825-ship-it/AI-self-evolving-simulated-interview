export * from './tables/index.ts';

import type { users } from './tables/identity.ts';
import type { interviews, interviewTurns } from './tables/interviews.ts';
import type { agentRuns, runEvents } from './tables/runs.ts';
import type { reports } from './tables/evaluations.ts';
import type { skillProfiles } from './tables/profiles.ts';

/** Row shapes for repositories; public API DTOs stay in packages/contracts. */
export type UserRow = typeof users.$inferSelect;
export type InterviewRow = typeof interviews.$inferSelect;
export type InterviewTurnRow = typeof interviewTurns.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;
export type RunEventRow = typeof runEvents.$inferSelect;
export type InterviewReportRow = typeof reports.$inferSelect;
export type SkillProfileRow = typeof skillProfiles.$inferSelect;
