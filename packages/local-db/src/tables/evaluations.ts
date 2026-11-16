import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const nowMs = sql`(unixepoch() * 1000)`;

const dimensionValues = sql`in ('correctness', 'depth', 'logic', 'role_fit', 'communication', 'speech_acoustics', 'speech_emotion')`;

export const evaluations = sqliteTable(
  'evaluation',
  {
    id: text('id').primaryKey(),
    interviewId: text('interview_id').notNull(),
    turnId: text('turn_id').notNull(),
    userId: text('user_id').notNull(),
    roleId: text('role_id').notNull(),
    skillId: text('skill_id').notNull(),
    questionId: text('question_id'),
    rubricId: text('rubric_id'),
    rubricVersion: text('rubric_version').notNull(),
    evaluatorVersion: text('evaluator_version').notNull(),
    scoringStatus: text('scoring_status').notNull().default('scored'),
    overallScore: real('overall_score'),
    confidence: real('confidence').notNull().default(0),
    missingDimensions: text('missing_dimensions', { mode: 'json' }).$type<string[]>().notNull().default([]),
    strengths: text('strengths', { mode: 'json' }).$type<string[]>().notNull().default([]),
    gaps: text('gaps', { mode: 'json' }).$type<string[]>().notNull().default([]),
    evidence: text('evidence', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    answerDigest: text('answer_digest'),
    answerVersion: integer('answer_version'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('evaluation_turn_unique').on(table.turnId),
    index('evaluation_interview_idx').on(table.interviewId),
    index('evaluation_skill_idx').on(table.userId, table.roleId, table.skillId),
    check('evaluation_scoring_status_values', sql`${table.scoringStatus} in ('scored', 'partial', 'skipped')`),
    check('evaluation_overall_range', sql`${table.overallScore} is null or ${table.overallScore} between 0 and 1`),
    check('evaluation_confidence_range', sql`${table.confidence} between 0 and 1`),
  ],
);

export const evaluationDimensions = sqliteTable(
  'evaluation_dimension',
  {
    evaluationId: text('evaluation_id').notNull(),
    dimension: text('dimension').notNull(),
    status: text('status').notNull().default('scored'),
    score: real('score'),
    evidenceRefs: text('evidence_refs', { mode: 'json' }).$type<string[]>().notNull().default([]),
    note: text('note'),
  },
  (table) => [
    primaryKey({ name: 'evaluation_dimension_pk', columns: [table.evaluationId, table.dimension] }),
    check('evaluation_dimension_values', sql`${table.dimension} ${dimensionValues}`),
    check('evaluation_dimension_status_values', sql`${table.status} in ('scored', 'zero', 'missing_evidence', 'abstained')`),
    check('evaluation_dimension_score_range', sql`${table.score} is null or ${table.score} between 0 and 1`),
    check('evaluation_dimension_scored_has_score', sql`${table.status} <> 'scored' or ${table.score} is not null`),
    check('evaluation_dimension_zero_score', sql`${table.status} <> 'zero' or ${table.score} = 0`),
    check(
      'evaluation_dimension_unscored_null',
      sql`${table.status} not in ('missing_evidence', 'abstained') or (${table.score} is null and ${table.evidenceRefs} = '[]')`,
    ),
  ],
);

export const reports = sqliteTable(
  'interview_report',
  {
    id: text('id').primaryKey(),
    interviewId: text('interview_id').notNull(),
    userId: text('user_id').notNull(),
    roleId: text('role_id').notNull(),
    policyVersion: text('policy_version').notNull(),
    rubricVersion: text('rubric_version').notNull(),
    overallScore: real('overall_score'),
    summary: text('summary'),
    strengths: text('strengths', { mode: 'json' }).$type<string[]>().notNull().default([]),
    gaps: text('gaps', { mode: 'json' }).$type<string[]>().notNull().default([]),
    practiceAdvice: text('practice_advice', { mode: 'json' }).$type<Record<string, unknown>[]>().notNull().default([]),
    missingDimensions: text('missing_dimensions', { mode: 'json' }).$type<string[]>().notNull().default([]),
    generatedAt: integer('generated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('interview_report_interview_unique').on(table.interviewId),
    index('interview_report_user_idx').on(table.userId, table.createdAt),
    check('interview_report_overall_range', sql`${table.overallScore} is null or ${table.overallScore} between 0 and 1`),
  ],
);

export const reportDimensions = sqliteTable(
  'report_dimension',
  {
    reportId: text('report_id').notNull(),
    dimension: text('dimension').notNull(),
    score: real('score'),
    evidenceRefs: text('evidence_refs', { mode: 'json' }).$type<string[]>().notNull().default([]),
    note: text('note'),
  },
  (table) => [
    primaryKey({ name: 'report_dimension_pk', columns: [table.reportId, table.dimension] }),
    check('report_dimension_values', sql`${table.dimension} ${dimensionValues}`),
    check('report_dimension_score_range', sql`${table.score} is null or ${table.score} between 0 and 1`),
  ],
);