import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const nowMs = sql`(unixepoch() * 1000)`;

export const reflections = sqliteTable(
  'reflection',
  {
    id: text('id').primaryKey(),
    interviewId: text('interview_id').notNull(),
    userId: text('user_id').notNull(),
    roleId: text('role_id').notNull(),
    status: text('status').notNull().default('pending'),
    skillCoverage: real('skill_coverage'),
    repeatRate: real('repeat_rate'),
    planAdherence: real('plan_adherence'),
    longestSkillRun: integer('longest_skill_run'),
    objectives: text('objectives', { mode: 'json' }).$type<string[]>().notNull().default([]),
    newEvidenceCount: integer('new_evidence_count').notNull().default(0),
    duplicateQuestionIds: text('duplicate_question_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    missedSkillIds: text('missed_skill_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    uncertainty: text('uncertainty', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    timing: text('timing', { mode: 'json' }).$type<Record<string, number>>().notNull().default({}),
    summary: text('summary'),
    candidatePolicyVersion: text('candidate_policy_version'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('reflection_interview_unique').on(table.interviewId),
    index('reflection_user_idx').on(table.userId, table.createdAt),
    check('reflection_status_values', sql`${table.status} in ('pending', 'completed', 'failed')`),
    check('reflection_skill_coverage_range', sql`${table.skillCoverage} is null or ${table.skillCoverage} between 0 and 1`),
    check('reflection_repeat_rate_range', sql`${table.repeatRate} is null or ${table.repeatRate} between 0 and 1`),
    check('reflection_plan_adherence_range', sql`${table.planAdherence} is null or ${table.planAdherence} between 0 and 1`),
    check('reflection_longest_run_non_negative', sql`${table.longestSkillRun} is null or ${table.longestSkillRun} >= 0`),
    check('reflection_completed_consistency', sql`(${table.status} = 'completed') = (${table.completedAt} is not null)`),
  ],
);

export const predictionSnapshots = sqliteTable(
  'prediction_snapshot',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    roleId: text('role_id').notNull(),
    skillId: text('skill_id').notNull(),
    sourceInterviewId: text('source_interview_id'),
    predictedAt: integer('predicted_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    expectedLearningExposure: text('expected_learning_exposure').notNull(),
    validUntil: integer('valid_until', { mode: 'timestamp_ms' }).notNull(),
    rubricVersion: text('rubric_version').notNull(),
    predictedTargetScore: real('predicted_target_score').notNull(),
    predictorVersion: text('predictor_version').notNull(),
    evidenceRefs: text('evidence_refs', { mode: 'json' }).$type<string[]>().notNull().default([]),
    status: text('status').notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    index('prediction_snapshot_skill_idx').on(table.userId, table.roleId, table.skillId, table.validUntil),
    index('prediction_snapshot_status_idx').on(table.status),
    check('prediction_snapshot_status_values', sql`${table.status} in ('pending', 'paired', 'expired')`),
    check('prediction_snapshot_score_range', sql`${table.predictedTargetScore} between 0 and 1`),
    check('prediction_snapshot_window', sql`${table.validUntil} > ${table.predictedAt}`),
    check('prediction_snapshot_exposure_not_blank', sql`length(trim(${table.expectedLearningExposure})) > 0`),
  ],
);

export const performancePairs = sqliteTable(
  'performance_pair',
  {
    id: text('id').primaryKey(),
    predictionId: text('prediction_id').notNull(),
    userId: text('user_id').notNull(),
    roleId: text('role_id').notNull(),
    skillId: text('skill_id').notNull(),
    retestInterviewId: text('retest_interview_id'),
    predictedScore: real('predicted_score').notNull(),
    referenceScore: real('reference_score'),
    mae: real('mae'),
    eligibility: text('eligibility').notNull().default('pending'),
    ineligibilityReasons: text('ineligibility_reasons', { mode: 'json' }).$type<string[]>().notNull().default([]),
    difficulty: integer('difficulty'),
    rubricVersion: text('rubric_version').notNull(),
    learningExposureMatched: integer('learning_exposure_matched', { mode: 'boolean' }).notNull().default(false),
    pairedAt: integer('paired_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('performance_pair_prediction_unique').on(table.predictionId),
    index('performance_pair_role_eligibility_idx').on(table.roleId, table.eligibility),
    check('performance_pair_eligibility_values', sql`${table.eligibility} in ('pending', 'eligible', 'ineligible')`),
    check('performance_pair_predicted_range', sql`${table.predictedScore} between 0 and 1`),
    check('performance_pair_reference_range', sql`${table.referenceScore} is null or ${table.referenceScore} between 0 and 1`),
    check('performance_pair_mae_non_negative', sql`${table.mae} is null or ${table.mae} >= 0`),
    check(
      'performance_pair_eligible_requires_reference',
      sql`${table.eligibility} <> 'eligible' or (${table.referenceScore} is not null and ${table.mae} is not null and ${table.learningExposureMatched} and ${table.retestInterviewId} is not null)`,
    ),
    check(
      'performance_pair_ineligible_reasons',
      sql`${table.eligibility} <> 'ineligible' or json_array_length(${table.ineligibilityReasons}) > 0`,
    ),
  ],
);