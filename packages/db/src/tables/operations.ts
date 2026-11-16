import { sql } from 'drizzle-orm';
import {
  check,
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
import { roles } from './catalog.ts';
import { evalExperiments } from './evolution.ts';
import { users } from './identity.ts';
import { interviews } from './interviews.ts';
import { agentRuns } from './runs.ts';
import {
  alertSeverity,
  alertStatus,
  feedbackCategory,
  feedbackStatus,
  metricScope,
  userRole,
  xpReason,
} from './enums.ts';

export const auditLogs = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: userRole('actor_role'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    outcome: text('outcome').notNull(),
    requestId: text('request_id'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_created_idx').on(table.createdAt),
    index('audit_log_actor_idx').on(table.actorId, table.createdAt),
    index('audit_log_target_idx').on(table.targetType, table.targetId),
    check('audit_log_outcome_values', sql`${table.outcome} in ('success', 'failure')`),
  ],
);

export const feedbackEntries = pgTable(
  'feedback_entry',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    interviewId: text('interview_id').references(() => interviews.id, { onDelete: 'set null' }),
    runId: text('run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    category: feedbackCategory('category').notNull(),
    rating: smallint('rating'),
    message: text('message'),
    status: feedbackStatus('status').notNull().default('open'),
    adminNote: text('admin_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    index('feedback_entry_status_idx').on(table.status, table.createdAt),
    check('feedback_entry_rating_range', sql`${table.rating} is null or ${table.rating} between 1 and 5`),
    check('feedback_entry_message_length', sql`${table.message} is null or char_length(${table.message}) between 1 and 2000`),
    check(
      'feedback_entry_resolved_consistency',
      sql`(${table.status} = 'resolved') = (${table.resolvedAt} is not null)`,
    ),
  ],
);

export const alerts = pgTable(
  'alert',
  {
    id: text('id').primaryKey(),
    severity: alertSeverity('severity').notNull(),
    source: text('source').notNull(),
    code: text('code').notNull(),
    message: text('message').notNull(),
    status: alertStatus('status').notNull().default('open'),
    interviewId: text('interview_id').references(() => interviews.id, { onDelete: 'set null' }),
    runId: text('run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    experimentId: text('experiment_id').references(() => evalExperiments.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    index('alert_status_idx').on(table.status, table.createdAt),
    index('alert_severity_idx').on(table.severity, table.createdAt),
    check(
      'alert_source_values',
      sql`${table.source} in ('api', 'agent', 'evaluation', 'speech', 'budget')`,
    ),
    check(
      'alert_acknowledged_consistency',
      sql`(${table.status} in ('acknowledged', 'resolved')) = (${table.acknowledgedAt} is not null)`,
    ),
  ],
);

export const metricSnapshots = pgTable(
  'metric_snapshot',
  {
    id: text('id').primaryKey(),
    scope: metricScope('scope').notNull(),
    roleId: text('role_id').references(() => roles.id, { onDelete: 'cascade' }),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    interviewCount: integer('interview_count').notNull().default(0),
    completedInterviewCount: integer('completed_interview_count').notNull().default(0),
    runFailureRate: numeric('run_failure_rate', { precision: 5, scale: 4 }),
    skillCoverage: numeric('skill_coverage', { precision: 5, scale: 4 }),
    repeatRate: numeric('repeat_rate', { precision: 5, scale: 4 }),
    planAdherence: numeric('plan_adherence', { precision: 5, scale: 4 }),
    longestSkillRun: integer('longest_skill_run'),
    p95LatencyMs: integer('p95_latency_ms'),
    sampleSize: integer('sample_size').notNull().default(0),
    metrics: jsonb('metrics').$type<Record<string, unknown>>().notNull().default({}),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('metric_snapshot_window_idx').on(table.scope, table.windowStart),
    check('metric_snapshot_window_order', sql`${table.windowEnd} > ${table.windowStart}`),
    check('metric_snapshot_scope_role', sql`(${table.scope} = 'role') = (${table.roleId} is not null)`),
    check(
      'metric_snapshot_ratio_ranges',
      sql`(${table.runFailureRate} is null or ${table.runFailureRate} between 0 and 1) and (${table.skillCoverage} is null or ${table.skillCoverage} between 0 and 1) and (${table.repeatRate} is null or ${table.repeatRate} between 0 and 1) and (${table.planAdherence} is null or ${table.planAdherence} between 0 and 1)`,
    ),
    check('metric_snapshot_counts_non_negative', sql`${table.interviewCount} >= 0 and ${table.completedInterviewCount} >= 0 and ${table.sampleSize} >= 0`),
  ],
);

export const xpEvents = pgTable(
  'xp_event',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: xpReason('reason').notNull(),
    xpDelta: integer('xp_delta').notNull().default(0),
    coinDelta: integer('coin_delta').notNull().default(0),
    balanceXp: integer('balance_xp').notNull(),
    balanceCoins: integer('balance_coins').notNull(),
    levelAfter: integer('level_after').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('xp_event_dedupe_unique').on(table.dedupeKey),
    index('xp_event_user_idx').on(table.userId, table.createdAt),
    check('xp_event_has_change', sql`${table.xpDelta} <> 0 or ${table.coinDelta} <> 0`),
    check(
      'xp_event_reason_direction',
      sql`(${table.reason} = 'hint_used' and ${table.coinDelta} < 0) or (${table.reason} <> 'hint_used' and ${table.xpDelta} >= 0 and ${table.coinDelta} >= 0)`,
    ),
    check(
      'xp_event_balances_non_negative',
      sql`${table.balanceXp} >= 0 and ${table.balanceCoins} >= 0 and ${table.levelAfter} >= 1`,
    ),
  ],
);
