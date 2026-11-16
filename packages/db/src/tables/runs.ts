import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { knowledgeItems } from './catalog.ts';
import { users } from './identity.ts';
import { interviewTurns, interviews } from './interviews.ts';
import { policyVersions } from './policies.ts';
import { planAction, runAttemptStatus, runEventType, runKind, runStatus } from './enums.ts';

export interface RunBudget {
  maxAttempts: number;
  maxLlmCallsPerAttempt: number;
  maxToolCallsPerAttempt: number;
  deadlineMs: number;
  llmCalls?: number;
  toolCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export const agentRuns = pgTable(
  'agent_run',
  {
    id: text('id').primaryKey(),
    interviewId: text('interview_id')
      .notNull()
      .references(() => interviews.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    turnId: text('turn_id').references(() => interviewTurns.id, { onDelete: 'set null' }),
    kind: runKind('kind').notNull(),
    status: runStatus('status').notNull().default('queued'),
    stage: text('stage'),
    attemptId: text('attempt_id'),
    attemptCount: smallint('attempt_count').notNull().default(0),
    inputSnapshot: jsonb('input_snapshot').$type<Record<string, unknown>>().notNull(),
    output: jsonb('output').$type<Record<string, unknown>>(),
    error: jsonb('error').$type<Record<string, unknown>>(),
    policyVersion: text('policy_version')
      .notNull()
      .references(() => policyVersions.version, { onDelete: 'restrict' }),
    budget: jsonb('budget').$type<RunBudget>().notNull().default({
      maxAttempts: 2,
      maxLlmCallsPerAttempt: 3,
      maxToolCallsPerAttempt: 5,
      deadlineMs: 120_000,
    }),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    lastEventSeq: integer('last_event_seq').notNull().default(0),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_run_interview_idx').on(table.interviewId, table.createdAt),
    index('agent_run_status_idx').on(table.status, table.createdAt),
    check('agent_run_attempt_count_range', sql`${table.attemptCount} between 0 and 2`),
    check('agent_run_last_event_seq_non_negative', sql`${table.lastEventSeq} >= 0`),
    check('agent_run_cancel_consistency', sql`(${table.status} <> 'cancelled') or ${table.cancelledAt} is not null`),
    check('agent_run_completed_consistency', sql`(${table.status} <> 'completed') or ${table.completedAt} is not null`),
  ],
);

export const runAttempts = pgTable(
  'run_attempt',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    attemptNo: smallint('attempt_no').notNull(),
    status: runAttemptStatus('status').notNull().default('running'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    provider: text('provider'),
    model: text('model'),
    usage: jsonb('usage').$type<Record<string, number>>().notNull().default({}),
    error: jsonb('error').$type<Record<string, unknown>>(),
    terminalReason: text('terminal_reason'),
  },
  (table) => [
    uniqueIndex('run_attempt_no_unique').on(table.runId, table.attemptNo),
    index('run_attempt_run_idx').on(table.runId, table.startedAt),
    check('run_attempt_no_range', sql`${table.attemptNo} between 1 and 2`),
    check('run_attempt_terminal_ended_at', sql`(${table.status} = 'running') = (${table.endedAt} is null)`),
  ],
);

export const runEvents = pgTable(
  'run_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    attemptId: text('attempt_id').references(() => runAttempts.id, { onDelete: 'set null' }),
    seq: integer('seq').notNull(),
    type: runEventType('type').notNull(),
    schemaVersion: smallint('schema_version').notNull().default(1),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('run_event_seq_unique').on(table.runId, table.seq),
    index('run_event_replay_idx').on(table.runId, table.seq),
    check('run_event_seq_non_negative', sql`${table.seq} >= 0`),
    check('run_event_schema_version_positive', sql`${table.schemaVersion} >= 1`),
  ],
);

export const planDecisions = pgTable(
  'plan_decision',
  {
    id: text('id').primaryKey(),
    interviewId: text('interview_id')
      .notNull()
      .references(() => interviews.id, { onDelete: 'cascade' }),
    runId: text('run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    turnId: text('turn_id').references(() => interviewTurns.id, { onDelete: 'set null' }),
    action: planAction('action').notNull(),
    skillId: text('skill_id').notNull(),
    questionId: text('question_id').references(() => knowledgeItems.id, { onDelete: 'set null' }),
    rationale: text('rationale').notNull(),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
    remainingSeconds: integer('remaining_seconds'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('plan_decision_interview_idx').on(table.interviewId, table.createdAt),
    check('plan_decision_rationale_length', sql`char_length(btrim(${table.rationale})) between 1 and 500`),
    check(
      'plan_decision_remaining_seconds_non_negative',
      sql`${table.remainingSeconds} is null or ${table.remainingSeconds} >= 0`,
    ),
  ],
);

export const idempotencyRecords = pgTable(
  'idempotency_record',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    route: text('route').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    interviewId: text('interview_id').references(() => interviews.id, { onDelete: 'set null' }),
    runId: text('run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idempotency_record_scope_unique').on(table.userId, table.route, table.idempotencyKey),
    check('idempotency_record_key_length', sql`char_length(${table.idempotencyKey}) between 1 and 128`),
  ],
);
