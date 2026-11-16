import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const nowMs = sql`(unixepoch() * 1000)`;

export const userGamification = sqliteTable(
  'user_gamification',
  {
    userId: text('user_id').primaryKey(),
    xpBalance: integer('xp_balance').notNull().default(0),
    coinBalance: integer('coin_balance').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    check('user_gamification_balances_non_negative', sql`${table.xpBalance} >= 0 and ${table.coinBalance} >= 0`),
  ],
);

export const xpEvents = sqliteTable(
  'xp_event',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    reason: text('reason').notNull(),
    xpDelta: integer('xp_delta').notNull().default(0),
    coinDelta: integer('coin_delta').notNull().default(0),
    balanceXp: integer('balance_xp').notNull(),
    balanceCoins: integer('balance_coins').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('xp_event_dedupe_unique').on(table.dedupeKey),
    index('xp_event_user_idx').on(table.userId, table.createdAt),
    check(
      'xp_event_reason_values',
      sql`${table.reason} in ('interview_completed', 'learning_completed', 'retest_completed', 'hint_used', 'admin_adjustment')`,
    ),
    check('xp_event_has_change', sql`${table.xpDelta} <> 0 or ${table.coinDelta} <> 0`),
    check(
      'xp_event_reason_direction',
      sql`(${table.reason} = 'hint_used' and ${table.coinDelta} < 0) or (${table.reason} <> 'hint_used' and ${table.xpDelta} >= 0 and ${table.coinDelta} >= 0)`,
    ),
    check('xp_event_balances_non_negative', sql`${table.balanceXp} >= 0 and ${table.balanceCoins} >= 0`),
  ],
);

export const skillProfiles = sqliteTable(
  'skill_profile',
  {
    userId: text('user_id').notNull(),
    roleId: text('role_id').notNull(),
    skillId: text('skill_id').notNull(),
    mastery: real('mastery'),
    confidence: real('confidence').notNull().default(0),
    evidenceCount: integer('evidence_count').notNull().default(0),
    lastUpdatedAt: integer('last_updated_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    primaryKey({ name: 'skill_profile_pk', columns: [table.userId, table.roleId, table.skillId] }),
    check('skill_profile_mastery_range', sql`${table.mastery} is null or ${table.mastery} between 0 and 1`),
    check('skill_profile_confidence_range', sql`${table.confidence} between 0 and 1`),
    check('skill_profile_evidence_non_negative', sql`${table.evidenceCount} >= 0`),
  ],
);

export const skillObservations = sqliteTable(
  'skill_observation',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    roleId: text('role_id').notNull(),
    skillId: text('skill_id').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    rubricVersion: text('rubric_version'),
    dimension: text('dimension'),
    score: real('score'),
    evidence: text('evidence', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    observedAt: integer('observed_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    index('skill_observation_scope_idx').on(table.userId, table.roleId, table.skillId, table.observedAt),
    check(
      'skill_observation_source_type_values',
      sql`${table.sourceType} in ('interview', 'retest', 'diagnostic')`,
    ),
    check('skill_observation_score_range', sql`${table.score} is null or ${table.score} between 0 and 1`),
  ],
);