import { pgTable, text, timestamp, integer, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
export const users = pgTable('app_user', { id: text('id').primaryKey(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow() });
export const interviews = pgTable('interview_session', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => users.id),
  roleId: text('role_id').notNull(), status: text('status').notNull(), version: integer('version').notNull().default(0),
  policyVersion: text('policy_version').notNull(), state: jsonb('state').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const turns = pgTable('interview_turn', {
  id: text('id').primaryKey(), interviewId: text('interview_id').notNull().references(() => interviews.id),
  idempotencyKey: text('idempotency_key').notNull(), question: text('question').notNull(), answer: text('answer'),
}, (table) => [uniqueIndex('turn_submission_unique').on(table.interviewId, table.idempotencyKey)]);
export const runs = pgTable('agent_run', {
  id: text('id').primaryKey(), interviewId: text('interview_id').notNull().references(() => interviews.id),
  status: text('status').notNull(), attemptId: text('attempt_id'), inputSnapshot: jsonb('input_snapshot').notNull(),
  leaseUntil: timestamp('lease_until', { withTimezone: true }), cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
});
// Schema foundation only: no database connection, migration or transaction is claimed yet.
