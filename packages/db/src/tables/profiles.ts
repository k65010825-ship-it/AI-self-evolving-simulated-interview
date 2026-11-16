import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { knowledgeItems, roleSkills } from './catalog.ts';
import { users } from './identity.ts';
import { interviewTurns, interviews } from './interviews.ts';
import { evaluations } from './evaluations.ts';
import { evidenceSource } from './enums.ts';

export const skillProfiles = pgTable(
  'skill_profile',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id').notNull(),
    skillId: text('skill_id').notNull(),
    mastery: numeric('mastery', { precision: 5, scale: 4 }),
    confidence: numeric('confidence', { precision: 5, scale: 4 }).notNull().default('0'),
    evidenceCount: integer('evidence_count').notNull().default(0),
    version: integer('version').notNull().default(1),
    lastEvidenceAt: timestamp('last_evidence_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'skill_profile_pk', columns: [table.userId, table.roleId, table.skillId] }),
    index('skill_profile_role_idx').on(table.userId, table.roleId),
    foreignKey({
      name: 'skill_profile_role_skill_fk',
      columns: [table.roleId, table.skillId],
      foreignColumns: [roleSkills.roleId, roleSkills.skillId],
    }).onDelete('cascade'),
    check('skill_profile_mastery_range', sql`${table.mastery} is null or ${table.mastery} between 0 and 1`),
    check('skill_profile_confidence_range', sql`${table.confidence} between 0 and 1`),
    check('skill_profile_evidence_count_non_negative', sql`${table.evidenceCount} >= 0`),
    check('skill_profile_version_positive', sql`${table.version} >= 1`),
    check(
      'skill_profile_evidence_consistency',
      sql`${table.mastery} is null or ${table.evidenceCount} > 0`,
    ),
  ],
);

export const skillObservations = pgTable(
  'skill_observation',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id').notNull(),
    skillId: text('skill_id').notNull(),
    interviewId: text('interview_id')
      .notNull()
      .references(() => interviews.id, { onDelete: 'cascade' }),
    turnId: text('turn_id')
      .notNull()
      .references(() => interviewTurns.id, { onDelete: 'cascade' }),
    evaluationId: text('evaluation_id').references(() => evaluations.id, { onDelete: 'set null' }),
    knowledgeItemId: text('knowledge_item_id').references(() => knowledgeItems.id, { onDelete: 'set null' }),
    source: evidenceSource('source').notNull(),
    independentEvidence: boolean('independent_evidence').notNull().default(true),
    dedupeKey: text('dedupe_key'),
    weight: numeric('weight', { precision: 5, scale: 4 }).notNull().default('1'),
    masteryBefore: numeric('mastery_before', { precision: 5, scale: 4 }),
    masteryAfter: numeric('mastery_after', { precision: 5, scale: 4 }),
    confidenceBefore: numeric('confidence_before', { precision: 5, scale: 4 }),
    confidenceAfter: numeric('confidence_after', { precision: 5, scale: 4 }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('skill_observation_skill_idx').on(table.userId, table.roleId, table.skillId, table.observedAt),
    index('skill_observation_interview_idx').on(table.interviewId),
    uniqueIndex('skill_observation_dedupe_unique')
      .on(table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null and ${table.independentEvidence}`),
    foreignKey({
      name: 'skill_observation_role_skill_fk',
      columns: [table.roleId, table.skillId],
      foreignColumns: [roleSkills.roleId, roleSkills.skillId],
    }).onDelete('cascade'),
    check('skill_observation_weight_range', sql`${table.weight} > 0 and ${table.weight} <= 1`),
    check('skill_observation_mastery_range', sql`(${table.masteryBefore} is null or ${table.masteryBefore} between 0 and 1) and (${table.masteryAfter} is null or ${table.masteryAfter} between 0 and 1)`),
    check('skill_observation_confidence_range', sql`(${table.confidenceBefore} is null or ${table.confidenceBefore} between 0 and 1) and (${table.confidenceAfter} is null or ${table.confidenceAfter} between 0 and 1)`),
  ],
);
