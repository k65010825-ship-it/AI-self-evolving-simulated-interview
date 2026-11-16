import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { roleSkills, roles } from './catalog.ts';
import { users } from './identity.ts';
import { interviews } from './interviews.ts';
import { policyVersions } from './policies.ts';
import { reflectionStatus, pairEligibility, predictionStatus } from './enums.ts';

export const reflections = pgTable(
  'reflection',
  {
    id: text('id').primaryKey(),
    interviewId: text('interview_id')
      .notNull()
      .references(() => interviews.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    status: reflectionStatus('status').notNull().default('pending'),
    skillCoverage: numeric('skill_coverage', { precision: 5, scale: 4 }),
    repeatRate: numeric('repeat_rate', { precision: 5, scale: 4 }),
    planAdherence: numeric('plan_adherence', { precision: 5, scale: 4 }),
    longestSkillRun: integer('longest_skill_run'),
    objectives: jsonb('objectives').$type<string[]>().notNull().default([]),
    newEvidenceCount: integer('new_evidence_count').notNull().default(0),
    duplicateQuestionIds: jsonb('duplicate_question_ids').$type<string[]>().notNull().default([]),
    missedSkillIds: jsonb('missed_skill_ids').$type<string[]>().notNull().default([]),
    uncertainty: jsonb('uncertainty').$type<Record<string, unknown>>().notNull().default({}),
    timing: jsonb('timing').$type<Record<string, number>>().notNull().default({}),
    summary: text('summary'),
    candidatePolicyVersion: text('candidate_policy_version').references(() => policyVersions.version, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('reflection_interview_unique').on(table.interviewId),
    index('reflection_user_idx').on(table.userId, table.createdAt),
    check('reflection_skill_coverage_range', sql`${table.skillCoverage} is null or ${table.skillCoverage} between 0 and 1`),
    check('reflection_repeat_rate_range', sql`${table.repeatRate} is null or ${table.repeatRate} between 0 and 1`),
    check('reflection_plan_adherence_range', sql`${table.planAdherence} is null or ${table.planAdherence} between 0 and 1`),
    check('reflection_longest_run_non_negative', sql`${table.longestSkillRun} is null or ${table.longestSkillRun} >= 0`),
    check('reflection_completed_consistency', sql`(${table.status} = 'completed') = (${table.completedAt} is not null)`),
  ],
);

export const predictionSnapshots = pgTable(
  'prediction_snapshot',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id').notNull(),
    skillId: text('skill_id').notNull(),
    sourceInterviewId: text('source_interview_id').references(() => interviews.id, { onDelete: 'set null' }),
    predictedAt: timestamp('predicted_at', { withTimezone: true }).notNull().defaultNow(),
    expectedLearningExposure: text('expected_learning_exposure').notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    rubricVersion: text('rubric_version').notNull(),
    predictedTargetScore: numeric('predicted_target_score', { precision: 5, scale: 4 }).notNull(),
    predictorVersion: text('predictor_version').notNull(),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    status: predictionStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('prediction_snapshot_skill_idx').on(table.userId, table.roleId, table.skillId, table.validUntil),
    index('prediction_snapshot_status_idx').on(table.status),
    foreignKey({
      name: 'prediction_snapshot_role_skill_fk',
      columns: [table.roleId, table.skillId],
      foreignColumns: [roleSkills.roleId, roleSkills.skillId],
    }).onDelete('cascade'),
    check(
      'prediction_snapshot_score_range',
      sql`${table.predictedTargetScore} between 0 and 1`,
    ),
    check('prediction_snapshot_window', sql`${table.validUntil} > ${table.predictedAt}`),
    check('prediction_snapshot_exposure_not_blank', sql`char_length(btrim(${table.expectedLearningExposure})) > 0`),
  ],
);

export const performancePairs = pgTable(
  'performance_pair',
  {
    id: text('id').primaryKey(),
    predictionId: text('prediction_id')
      .notNull()
      .references(() => predictionSnapshots.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id').notNull(),
    skillId: text('skill_id').notNull(),
    retestInterviewId: text('retest_interview_id').references(() => interviews.id, { onDelete: 'set null' }),
    predictedScore: numeric('predicted_score', { precision: 5, scale: 4 }).notNull(),
    referenceScore: numeric('reference_score', { precision: 5, scale: 4 }),
    mae: numeric('mae', { precision: 5, scale: 4 }),
    eligibility: pairEligibility('eligibility').notNull().default('pending'),
    ineligibilityReasons: jsonb('ineligibility_reasons').$type<string[]>().notNull().default([]),
    difficulty: smallint('difficulty'),
    rubricVersion: text('rubric_version').notNull(),
    learningExposureMatched: boolean('learning_exposure_matched').notNull().default(false),
    pairedAt: timestamp('paired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('performance_pair_prediction_unique').on(table.predictionId),
    index('performance_pair_role_eligibility_idx').on(table.roleId, table.eligibility),
    foreignKey({
      name: 'performance_pair_role_skill_fk',
      columns: [table.roleId, table.skillId],
      foreignColumns: [roleSkills.roleId, roleSkills.skillId],
    }).onDelete('cascade'),
    check('performance_pair_predicted_range', sql`${table.predictedScore} between 0 and 1`),
    check(
      'performance_pair_reference_range',
      sql`${table.referenceScore} is null or ${table.referenceScore} between 0 and 1`,
    ),
    check('performance_pair_mae_non_negative', sql`${table.mae} is null or ${table.mae} >= 0`),
    check(
      'performance_pair_eligible_requires_reference',
      sql`${table.eligibility} <> 'eligible' or (${table.referenceScore} is not null and ${table.mae} is not null and ${table.learningExposureMatched} and ${table.retestInterviewId} is not null)`,
    ),
    check(
      'performance_pair_ineligible_reasons',
      sql`${table.eligibility} <> 'ineligible' or jsonb_array_length(${table.ineligibilityReasons}) > 0`,
    ),
  ],
);
