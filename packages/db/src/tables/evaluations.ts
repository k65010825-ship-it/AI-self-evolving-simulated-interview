import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { knowledgeItems, roleSkills, roles, rubrics } from './catalog.ts';
import { users } from './identity.ts';
import { interviewTurns, interviews } from './interviews.ts';
import { evaluationDimension } from './enums.ts';

export const evaluations = pgTable(
  'evaluation',
  {
    id: text('id').primaryKey(),
    interviewId: text('interview_id')
      .notNull()
      .references(() => interviews.id, { onDelete: 'cascade' }),
    turnId: text('turn_id')
      .notNull()
      .references(() => interviewTurns.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id').notNull(),
    skillId: text('skill_id').notNull(),
    questionId: text('question_id').references(() => knowledgeItems.id, { onDelete: 'set null' }),
    rubricId: text('rubric_id').references(() => rubrics.id, { onDelete: 'set null' }),
    rubricVersion: text('rubric_version').notNull(),
    evaluatorVersion: text('evaluator_version').notNull(),
    overallScore: numeric('overall_score', { precision: 5, scale: 4 }),
    confidence: numeric('confidence', { precision: 5, scale: 4 }).notNull().default('0'),
    missingDimensions: jsonb('missing_dimensions').$type<string[]>().notNull().default([]),
    strengths: jsonb('strengths').$type<string[]>().notNull().default([]),
    gaps: jsonb('gaps').$type<string[]>().notNull().default([]),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('evaluation_turn_unique').on(table.turnId),
    index('evaluation_interview_idx').on(table.interviewId),
    index('evaluation_skill_idx').on(table.userId, table.roleId, table.skillId),
    foreignKey({
      name: 'evaluation_role_skill_fk',
      columns: [table.roleId, table.skillId],
      foreignColumns: [roleSkills.roleId, roleSkills.skillId],
    }).onDelete('restrict'),
    check('evaluation_overall_range', sql`${table.overallScore} is null or ${table.overallScore} between 0 and 1`),
    check('evaluation_confidence_range', sql`${table.confidence} between 0 and 1`),
  ],
);

export const evaluationDimensions = pgTable(
  'evaluation_dimension',
  {
    evaluationId: text('evaluation_id')
      .notNull()
      .references(() => evaluations.id, { onDelete: 'cascade' }),
    dimension: evaluationDimension('dimension').notNull(),
    score: numeric('score', { precision: 5, scale: 4 }),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    note: text('note'),
  },
  (table) => [
    primaryKey({ name: 'evaluation_dimension_pk', columns: [table.evaluationId, table.dimension] }),
    check('evaluation_dimension_score_range', sql`${table.score} is null or ${table.score} between 0 and 1`),
    check(
      'evaluation_dimension_missing_consistency',
      sql`${table.score} is not null or jsonb_array_length(${table.evidenceRefs}) = 0`,
    ),
  ],
);

export const reports = pgTable(
  'interview_report',
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
      .references(() => roles.id, { onDelete: 'restrict' }),
    policyVersion: text('policy_version').notNull(),
    rubricVersion: text('rubric_version').notNull(),
    overallScore: numeric('overall_score', { precision: 5, scale: 4 }),
    summary: text('summary'),
    strengths: jsonb('strengths').$type<string[]>().notNull().default([]),
    gaps: jsonb('gaps').$type<string[]>().notNull().default([]),
    practiceAdvice: jsonb('practice_advice').$type<Record<string, unknown>[]>().notNull().default([]),
    missingDimensions: jsonb('missing_dimensions').$type<string[]>().notNull().default([]),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('interview_report_interview_unique').on(table.interviewId),
    index('interview_report_user_idx').on(table.userId, table.createdAt),
    check(
      'interview_report_overall_range',
      sql`${table.overallScore} is null or ${table.overallScore} between 0 and 1`,
    ),
  ],
);

export const reportDimensions = pgTable(
  'report_dimension',
  {
    reportId: text('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    dimension: evaluationDimension('dimension').notNull(),
    score: numeric('score', { precision: 5, scale: 4 }),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    note: text('note'),
  },
  (table) => [
    primaryKey({ name: 'report_dimension_pk', columns: [table.reportId, table.dimension] }),
    check('report_dimension_score_range', sql`${table.score} is null or ${table.score} between 0 and 1`),
  ],
);
