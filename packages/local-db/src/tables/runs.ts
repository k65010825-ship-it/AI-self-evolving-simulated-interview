import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import { interviewSessions, interviewTurns } from './interviews.ts';

// Rebuildable diagnostics only; local_jobs/events and live/speech ledgers remain authoritative.
const nowMs = sql`(unixepoch() * 1000)`;

export const agentRuns = sqliteTable(
  'agent_run',
  {
    id: text('id').primaryKey(),
    interviewId: text('interview_id').notNull().references(() => interviewSessions.id, { onDelete: 'restrict' }),
    userId: text('user_id').notNull(),
    turnId: text('turn_id').references(() => interviewTurns.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('queued'),
    stage: text('stage'),
    attemptId: text('attempt_id').references((): AnySQLiteColumn => runAttempts.id, { onDelete: 'restrict' }),
    attemptCount: integer('attempt_count').notNull().default(0),
    inputSnapshot: text('input_snapshot', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    output: text('output', { mode: 'json' }).$type<Record<string, unknown>>(),
    error: text('error', { mode: 'json' }).$type<Record<string, unknown>>(),
    policyVersion: text('policy_version').notNull(),
    budget: text('budget', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({
      maxAttempts: 2,
      maxLlmCallsPerAttempt: 3,
      maxToolCallsPerAttempt: 5,
      deadlineMs: 120_000,
    }),
    deadlineAt: integer('deadline_at', { mode: 'timestamp_ms' }),
    lastEventSeq: integer('last_event_seq').notNull().default(0),
    cancelRequestedAt: integer('cancel_requested_at', { mode: 'timestamp_ms' }),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    index('agent_run_interview_idx').on(table.interviewId, table.createdAt),
    index('agent_run_status_idx').on(table.status, table.createdAt),
    check('agent_run_status_values', sql`${table.status} in ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')`),
    check(
      'agent_run_kind_values',
      sql`${table.kind} in ('initial_plan', 'answer_processing', 'finish', 'reflection', 'experiment_evaluation', 'learning_recommendation')`,
    ),
    check('agent_run_attempt_count_range', sql`${table.attemptCount} between 0 and 2`),
    check('agent_run_last_event_seq_non_negative', sql`${table.lastEventSeq} >= 0`),
    check('agent_run_cancel_consistency', sql`(${table.status} <> 'cancelled') or ${table.cancelledAt} is not null`),
    check('agent_run_completed_consistency', sql`(${table.status} <> 'completed') or ${table.completedAt} is not null`),
  ],
);

export const runAttempts = sqliteTable(
  'run_attempt',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => agentRuns.id, { onDelete: 'restrict' }),
    attemptNo: integer('attempt_no').notNull(),
    status: text('status').notNull().default('running'),
    leaseUntil: integer('lease_until', { mode: 'timestamp_ms' }),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    provider: text('provider'),
    model: text('model'),
    usage: text('usage', { mode: 'json' }).$type<Record<string, number>>().notNull().default({}),
    error: text('error', { mode: 'json' }).$type<Record<string, unknown>>(),
    terminalReason: text('terminal_reason'),
  },
  (table) => [
    uniqueIndex('run_attempt_no_unique').on(table.runId, table.attemptNo),
    index('run_attempt_run_idx').on(table.runId, table.startedAt),
    check('run_attempt_status_values', sql`${table.status} in ('running', 'completed', 'failed', 'cancelled', 'expired')`),
    check('run_attempt_no_range', sql`${table.attemptNo} between 1 and 2`),
    check('run_attempt_terminal_ended_at', sql`(${table.status} = 'running') = (${table.endedAt} is null)`),
  ],
);

export const runEvents = sqliteTable(
  'run_event',
  {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    runId: text('run_id').notNull().references(() => agentRuns.id, { onDelete: 'restrict' }),
    attemptId: text('attempt_id').references(() => runAttempts.id, { onDelete: 'restrict' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('run_event_seq_unique').on(table.runId, table.seq),
    index('run_event_replay_idx').on(table.runId, table.seq),
    check(
      'run_event_type_values',
      sql`${table.type} in ('run.accepted', 'run.stage', 'question.delta', 'question.completed', 'run.completed', 'run.failed', 'run.cancelled', 'local.event')`,
    ),
    check('run_event_seq_non_negative', sql`${table.seq} >= 0`),
    check('run_event_schema_version_positive', sql`${table.schemaVersion} >= 1`),
  ],
);

export const planDecisions = sqliteTable(
  'plan_decision',
  {
    id: text('id').primaryKey(),
    interviewId: text('interview_id').notNull().references(() => interviewSessions.id, { onDelete: 'restrict' }),
    runId: text('run_id').references(() => agentRuns.id, { onDelete: 'restrict' }),
    turnId: text('turn_id').references(() => interviewTurns.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    skillId: text('skill_id').notNull(),
    questionId: text('question_id'),
    rationale: text('rationale').notNull(),
    evidenceRefs: text('evidence_refs', { mode: 'json' }).$type<string[]>().notNull().default([]),
    remainingSeconds: integer('remaining_seconds'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    index('plan_decision_interview_idx').on(table.interviewId, table.createdAt),
    check('plan_decision_action_values', sql`${table.action} in ('deepen', 'switch_skill', 'adjust_difficulty', 'finish')`),
    check('plan_decision_rationale_length', sql`length(trim(${table.rationale})) between 1 and 500`),
    check('plan_decision_remaining_seconds_non_negative', sql`${table.remainingSeconds} is null or ${table.remainingSeconds} >= 0`),
  ],
);

export const idempotencyRecords = sqliteTable(
  'idempotency_record',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    route: text('route').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    interviewId: text('interview_id').references(() => interviewSessions.id, { onDelete: 'restrict' }),
    runId: text('run_id').references(() => agentRuns.id, { onDelete: 'restrict' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('idempotency_record_scope_unique').on(table.userId, table.route, table.idempotencyKey),
    check('idempotency_record_key_length', sql`length(${table.idempotencyKey}) between 1 and 128`),
  ],
);

export const budgetLedger = sqliteTable(
  'budget_ledger',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().references(() => agentRuns.id, { onDelete: 'restrict' }),
    attemptId: text('attempt_id').references(() => runAttempts.id, { onDelete: 'restrict' }),
    operation: text('operation').notNull(),
    status: text('status').notNull().default('open'),
    llmCalls: integer('llm_calls').notNull().default(0),
    toolCalls: integer('tool_calls').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    settledAt: integer('settled_at', { mode: 'timestamp_ms' }),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    index('budget_ledger_run_idx').on(table.runId, table.createdAt),
    check('budget_ledger_operation_values', sql`${table.operation} in ('reserve', 'dispatch', 'settle', 'unknown')`),
    check('budget_ledger_status_values', sql`${table.status} in ('open', 'settled', 'unknown')`),
    check('budget_ledger_amounts_non_negative', sql`${table.llmCalls} >= 0 and ${table.toolCalls} >= 0 and ${table.inputTokens} >= 0 and ${table.outputTokens} >= 0`),
    check('budget_ledger_settled_consistency', sql`(${table.status} = 'settled') = (${table.settledAt} is not null)`),
  ],
);
