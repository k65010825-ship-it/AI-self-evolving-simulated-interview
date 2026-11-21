import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { jobRoles, roleSkills } from './catalog.ts';
import { learningResourceAvailability, learningResourceLevel, reviewStatus } from './enums.ts';

export const learningResources = pgTable(
  'learning_resource',
  {
    id: text('id').primaryKey(),
    roleId: text('role_id')
      .notNull()
      .references(() => jobRoles.id, { onDelete: 'cascade' }),
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