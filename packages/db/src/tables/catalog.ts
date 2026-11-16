import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './identity.ts';
import {
  knowledgeReviewDecision,
  questionType,
  reviewStatus,
  sourceVerificationStatus,
} from './enums.ts';

export const roles = pgTable(
  'role',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    summary: text('summary').notNull(),
    knowledgeVersion: text('knowledge_version').notNull(),
    rubricVersion: text('rubric_version').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('role_name_length', sql`char_length(${table.name}) between 1 and 80`)],
);

export const roleSkills = pgTable(
  'role_skill',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    skillId: text('skill_id').notNull(),
    name: text('name').notNull(),
    summary: text('summary'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'role_skill_pk', columns: [table.roleId, table.skillId] }),
    check('role_skill_skill_id_length', sql`char_length(${table.skillId}) between 1 and 80`),
  ],
);

export const knowledgeSources = pgTable(
  'knowledge_source',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    url: text('url'),
    owner: text('owner').notNull(),
    licenseNote: text('license_note').notNull(),
    retrievedAt: date('retrieved_at'),
    lastCheckedAt: date('last_checked_at'),
    verificationStatus: sourceVerificationStatus('verification_status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('knowledge_source_url_scheme', sql`${table.url} is null or ${table.url} ~ '^https?://'`)],
);

export const rubrics = pgTable(
  'rubric',
  {
    id: text('id').primaryKey(),
    roleId: text('role_id').notNull(),
    skillId: text('skill_id').notNull(),
    questionType: questionType('question_type'),
    version: text('version').notNull(),
    reviewStatus: reviewStatus('review_status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('rubric_scope_version_unique').on(table.roleId, table.skillId, table.version),
    index('rubric_role_idx').on(table.roleId),
    foreignKey({
      name: 'rubric_role_skill_fk',
      columns: [table.roleId, table.skillId],
      foreignColumns: [roleSkills.roleId, roleSkills.skillId],
    }).onDelete('cascade'),
    check('rubric_version_length', sql`char_length(${table.version}) between 1 and 40`),
  ],
);

export const rubricCriteria = pgTable(
  'rubric_criterion',
  {
    rubricId: text('rubric_id')
      .notNull()
      .references(() => rubrics.id, { onDelete: 'cascade' }),
    criterionId: text('criterion_id').notNull(),
    description: text('description').notNull(),
    maxScore: numeric('max_score', { precision: 5, scale: 2 }).notNull(),
    weight: numeric('weight', { precision: 5, scale: 4 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    primaryKey({ name: 'rubric_criterion_pk', columns: [table.rubricId, table.criterionId] }),
    check('rubric_criterion_max_score_positive', sql`${table.maxScore} > 0`),
    check('rubric_criterion_weight_range', sql`${table.weight} > 0 and ${table.weight} <= 1`),
  ],
);

export const knowledgeItems = pgTable(
  'knowledge_item',
  {
    id: text('id').primaryKey(),
    roleId: text('role_id').notNull(),
    skillId: text('skill_id').notNull(),
    questionType: questionType('question_type').notNull(),
    difficulty: smallint('difficulty').notNull(),
    question: text('question').notNull(),
    keyPoints: jsonb('key_points').$type<string[]>().notNull(),
    rubricId: text('rubric_id')
      .notNull()
      .references(() => rubrics.id, { onDelete: 'restrict' }),
    version: text('version').notNull(),
    reviewStatus: reviewStatus('review_status').notNull().default('draft'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('knowledge_item_scope_idx').on(table.roleId, table.skillId, table.reviewStatus),
    index('knowledge_item_role_type_idx').on(table.roleId, table.questionType),
    foreignKey({
      name: 'knowledge_item_role_skill_fk',
      columns: [table.roleId, table.skillId],
      foreignColumns: [roleSkills.roleId, roleSkills.skillId],
    }).onDelete('cascade'),
    check('knowledge_item_difficulty_range', sql`${table.difficulty} between 1 and 5`),
    check('knowledge_item_question_not_blank', sql`char_length(btrim(${table.question})) > 0`),
    check('knowledge_item_key_points_not_empty', sql`jsonb_array_length(${table.keyPoints}) > 0`),
  ],
);

export const knowledgeItemSources = pgTable(
  'knowledge_item_source',
  {
    knowledgeItemId: text('knowledge_item_id')
      .notNull()
      .references(() => knowledgeItems.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({ name: 'knowledge_item_source_pk', columns: [table.knowledgeItemId, table.sourceId] }),
    index('knowledge_item_source_source_idx').on(table.sourceId),
  ],
);

export const knowledgeReviews = pgTable(
  'knowledge_review',
  {
    id: text('id').primaryKey(),
    knowledgeItemId: text('knowledge_item_id')
      .notNull()
      .references(() => knowledgeItems.id, { onDelete: 'cascade' }),
    decision: knowledgeReviewDecision('decision').notNull(),
    fromStatus: reviewStatus('from_status').notNull(),
    toStatus: reviewStatus('to_status').notNull(),
    reviewerId: text('reviewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('knowledge_review_item_idx').on(table.knowledgeItemId, table.createdAt),
    check(
      'knowledge_review_status_change',
      sql`(${table.decision} = 'approve' and ${table.fromStatus} = 'draft' and ${table.toStatus} = 'reviewed') or (${table.decision} = 'reject' and ${table.toStatus} = ${table.fromStatus}) or (${table.decision} = 'deprecate' and ${table.toStatus} = 'draft')`,
    ),
  ],
);
