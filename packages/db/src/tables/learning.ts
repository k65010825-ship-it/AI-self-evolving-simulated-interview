import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { roleSkills, roles } from './catalog.ts';
import { reports } from './evaluations.ts';
import { users } from './identity.ts';
import { interviews } from './interviews.ts';
import {
  evidenceLevel,
  learningProgressStatus,
  learningResourceAvailability,
  learningResourceLevel,
  recommendationAction,
  recommendationStatus,
  reviewStatus,
} from './enums.ts';

export const learningResources = pgTable(
  'learning_resource',
  {
    id: text('id').primaryKey(),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    url: text('url').notNull(),
    provider: text('provider').notNull(),
    level: learningResourceLevel('level').notNull().default('intermediate'),
    estimatedMinutes: integer('estimated_minutes'),
    lastCheckedAt: date('last_checked_at'),
    reviewStatus: reviewStatus('review_status').notNull().default('draft'),
    availability: learningResourceAvailability('availability').notNull().default('available'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('learning_resource_role_idx').on(table.roleId, table.reviewStatus),
    check('learning_resource_url_scheme', sql`${table.url} ~ '^https?://'`),
    check(
      'learning_resource_estimated_minutes_positive',
      sql`${table.estimatedMinutes} is null or ${table.estimatedMinutes} > 0`,
    ),
  ],
);

export const learningResourceSkills = pgTable(
  'learning_resource_skill',
  {
    resourceId: text('resource_id')
      .notNull()
      .references(() => learningResources.id, { onDelete: 'cascade' }),
    roleId: text('role_id').notNull(),
    skillId: text('skill_id').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'learning_resource_skill_pk',
      columns: [table.resourceId, table.roleId, table.skillId],
    }),
    index('learning_resource_skill_scope_idx').on(table.roleId, table.skillId),
    foreignKey({
      name: 'learning_resource_skill_role_fk',
      columns: [table.roleId, table.skillId],
      foreignColumns: [roleSkills.roleId, roleSkills.skillId],
    }).onDelete('cascade'),
  ],
);

export const learningProgress = pgTable(
  'learning_progress',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    resourceId: text('resource_id')
      .notNull()
      .references(() => learningResources.id, { onDelete: 'cascade' }),
    status: learningProgressStatus('status').notNull().default('started'),
    evidenceLevel: evidenceLevel('evidence_level'),
    evidence: jsonb('evidence').$type<Record<string, unknown>>(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('learning_progress_user_idx').on(table.userId, table.resourceId),
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

export const recommendations = pgTable(
  'recommendation',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id').notNull(),
    skillId: text('skill_id').notNull(),
    interviewId: text('interview_id').references(() => interviews.id, { onDelete: 'set null' }),
    reportId: text('report_id').references(() => reports.id, { onDelete: 'set null' }),
    resourceId: text('resource_id').references(() => learningResources.id, { onDelete: 'set null' }),
    action: recommendationAction('action').notNull(),
    rationale: text('rationale').notNull(),
    status: recommendationStatus('status').notNull().default('suggested'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('recommendation_user_skill_idx').on(table.userId, table.roleId, table.skillId),
    foreignKey({
      name: 'recommendation_role_skill_fk',
      columns: [table.roleId, table.skillId],
      foreignColumns: [roleSkills.roleId, roleSkills.skillId],
    }).onDelete('cascade'),
    check('recommendation_rationale_not_blank', sql`char_length(btrim(${table.rationale})) > 0`),
    check(
      'recommendation_resource_requirement',
      sql`${table.action} <> 'review_resource' or ${table.resourceId} is not null`,
    ),
  ],
);
