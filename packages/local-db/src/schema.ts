export * from './tables/index.ts';

import type { skillProfiles, skillObservations } from './tables/profile.ts';
import type { interviewSessions, interviewTurns } from './tables/interviews.ts';
import type { agentRuns, runAttempts, runEvents, budgetLedger } from './tables/runs.ts';
import type { evaluations, reports } from './tables/evaluations.ts';
import type { reflections, predictionSnapshots, performancePairs } from './tables/reflection.ts';

/** Proposed business extensions and rebuildable projections. Not a replacement for profile v3 local_* authority. */
export type SkillProfileRow = typeof skillProfiles.$inferSelect;
export type SkillObservationRow = typeof skillObservations.$inferSelect;
export type InterviewSessionRow = typeof interviewSessions.$inferSelect;
export type InterviewTurnRow = typeof interviewTurns.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;
export type RunAttemptRow = typeof runAttempts.$inferSelect;
export type RunEventRow = typeof runEvents.$inferSelect;
export type BudgetLedgerRow = typeof budgetLedger.$inferSelect;
export type EvaluationRow = typeof evaluations.$inferSelect;
export type InterviewReportRow = typeof reports.$inferSelect;
export type ReflectionRow = typeof reflections.$inferSelect;
export type PredictionSnapshotRow = typeof predictionSnapshots.$inferSelect;
export type PerformancePairRow = typeof performancePairs.$inferSelect;