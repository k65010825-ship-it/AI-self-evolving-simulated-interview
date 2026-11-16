import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { interviewSessions } from './interviews.ts';
import { reports } from './evaluations.ts';

const nowMs = sql`(unixepoch() * 1000)`;

export const learningProgress = sqliteTable(
  'learning_progress',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    resourceId: text('resource_id').notNull(),
    status: text('status').notNull().default('started'),
    evidenceLevel: text('evidence_level'),
    evidence: text('evidence', { mode: 'json' }).$type<Record<string, unknown>>(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    index('learning_progress_user_idx').on(table.userId, table.resourceId),
    check('learning_progress_status_values', sql`${table.status} in ('started', 'self_reported', 'verified', 'abandoned')`),
    check('learning_progress_evidence_level_values', sql`${table.evidenceLevel} is null or ${table.evidenceLevel} in ('self_reported', 'verifiable')`),
    check(
      'learning_progress_completion_consistency',
      sql`(${table.status} in ('self_reported', 'verified')) = (${table.completedAt} is not null and ${table.evidenceLevel} is not null)`,
    ),
    check(
      'learning_progress_evidence_level_match',
      sql`(${table.status} = 'self_reported' and ${table.evidenceLevel} = 'self_reported') or (${table.status} = 'verified' and ${table.evidenceLevel} = 'verifiable') or (${table.status} in ('started', 'abandoned') and ${table.evidenceLevel} is null)`,
    ),
  ],
);

export const recommendations = sqliteTable(
  'recommendation',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    roleId: text('role_id').notNull(),
    skillId: text('skill_id').notNull(),
    interviewId: text('interview_id').references(() => interviewSessions.id, { onDelete: 'restrict' }),
    reportId: text('report_id').references(() => reports.id, { onDelete: 'restrict' }),
    resourceId: text('resource_id'),
    action: text('action').notNull(),
    rationale: text('rationale').notNull(),
    status: text('status').notNull().default('suggested'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    index('recommendation_user_skill_idx').on(table.userId, table.roleId, table.skillId),
    check('recommendation_action_values', sql`${table.action} in ('practice', 'review_resource', 'retest')`),
    check('recommendation_status_values', sql`${table.status} in ('suggested', 'accepted', 'completed', 'dismissed')`),
    check('recommendation_rationale_not_blank', sql`length(trim(${table.rationale})) > 0`),
    check('recommendation_resource_requirement', sql`${table.action} <> 'review_resource' or ${table.resourceId} is not null`),
  ],
);