import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  check,
  foreignKey,
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
import { knowledgeItems, roles } from './catalog.ts';
import { users } from './identity.ts';
import { policyVersions } from './policies.ts';
import {
  answerModality,
  audioAssetStatus,
  interviewKind,
  interviewStatus,
  questionType,
  transcriptStatus,
  turnStatus,
} from './enums.ts';

export interface InterviewSkillState {
  skillId: string;
  mastery: number | null;
  confidence: number;
  evidenceCount: number;
}

export interface InterviewStateSnapshot {
  testedSkillIds?: string[];
  pendingSkillIds?: string[];
  weakSkillIds?: string[];
  skillStates?: InterviewSkillState[];
  practicedQuestionIds?: string[];
  remainingSeconds?: number;
  difficulty?: number;
  followupDepth?: number;
}

export const interviews = pgTable(
  'interview_session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    kind: interviewKind('kind').notNull().default('practice'),
    retestOfInterviewId: text('retest_of_interview_id'),
    goal: text('goal').notNull(),
    durationMinutes: smallint('duration_minutes').notNull(),
    status: interviewStatus('status').notNull().default('planning'),
    sessionVersion: integer('session_version').notNull().default(0),
    policyVersion: text('policy_version')
      .notNull()
      .default('baseline-v0')
      .references(() => policyVersions.version, { onDelete: 'restrict' }),
    currentQuestionId: text('current_question_id').references(() => knowledgeItems.id, { onDelete: 'set null' }),
    state: jsonb('state').$type<InterviewStateSnapshot>().notNull().default({}),
    failure: jsonb('failure').$type<Record<string, unknown>>(),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('interview_session_user_created_idx').on(table.userId, table.createdAt),
    index('interview_session_user_status_idx').on(table.userId, table.status),
    index('interview_session_role_idx').on(table.roleId),
    foreignKey({
      name: 'interview_session_retest_fk',
      columns: [table.retestOfInterviewId],
      foreignColumns: [table.id],
    }).onDelete('set null'),
    check('interview_session_goal_length', sql`char_length(btrim(${table.goal})) between 1 and 500`),
    check('interview_session_duration_range', sql`${table.durationMinutes} between 15 and 25`),
    check('interview_session_version_non_negative', sql`${table.sessionVersion} >= 0`),
    check('interview_session_retest_not_self', sql`${table.retestOfInterviewId} is null or ${table.retestOfInterviewId} <> ${table.id}`),
    check(
      'interview_session_completed_at_consistency',
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null)`,
    ),
  ],
);

export const interviewTurns = pgTable(
  'interview_turn',
  {
    id: text('id').primaryKey(),
    interviewId: text('interview_id')
      .notNull()
      .references(() => interviews.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    questionId: text('question_id').references(() => knowledgeItems.id, { onDelete: 'set null' }),
    questionText: text('question_text').notNull(),
    questionType: questionType('question_type').notNull(),
    skillId: text('skill_id').notNull(),
    difficulty: smallint('difficulty').notNull(),
    status: turnStatus('status').notNull().default('awaiting_answer'),
    answer: text('answer'),
    answerModality: answerModality('answer_modality'),
    answerTranscriptId: text('answer_transcript_id').references((): AnyPgColumn => transcripts.id, {
      onDelete: 'set null',
    }),
    idempotencyKey: text('idempotency_key'),
    hintsUsed: integer('hints_used').notNull().default(0),
    answerSubmittedAt: timestamp('answer_submitted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('interview_turn_seq_unique').on(table.interviewId, table.seq),
    uniqueIndex('interview_turn_idempotency_unique')
      .on(table.interviewId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index('interview_turn_interview_idx').on(table.interviewId, table.seq),
    check('interview_turn_seq_non_negative', sql`${table.seq} >= 0`),
    check('interview_turn_difficulty_range', sql`${table.difficulty} between 1 and 5`),
    check('interview_turn_answer_length', sql`${table.answer} is null or char_length(${table.answer}) between 1 and 10000`),
    check('interview_turn_hints_non_negative', sql`${table.hintsUsed} >= 0`),
    check(
      'interview_turn_answer_consistency',
      sql`(${table.status} = 'answered') = (${table.answer} is not null and ${table.answerSubmittedAt} is not null)`,
    ),
  ],
);

export const audioAssets = pgTable(
  'audio_asset',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    interviewId: text('interview_id')
      .notNull()
      .references(() => interviews.id, { onDelete: 'cascade' }),
    turnId: text('turn_id').references(() => interviewTurns.id, { onDelete: 'set null' }),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    durationMs: integer('duration_ms'),
    status: audioAssetStatus('status').notNull().default('uploaded'),
    consentForReview: boolean('consent_for_review').notNull().default(false),
    retentionUntil: timestamp('retention_until', { withTimezone: true }),
    deleteRequestedAt: timestamp('delete_requested_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audio_asset_interview_idx').on(table.interviewId),
    index('audio_asset_user_idx').on(table.userId),
    check('audio_asset_byte_size_positive', sql`${table.byteSize} > 0`),
    check('audio_asset_duration_positive', sql`${table.durationMs} is null or ${table.durationMs} > 0`),
    check(
      'audio_asset_retention_requires_consent',
      sql`${table.retentionUntil} is null or ${table.consentForReview}`,
    ),
    check(
      'audio_asset_deleted_at_consistency',
      sql`(${table.status} = 'deleted') = (${table.deletedAt} is not null)`,
    ),
  ],
);

export const transcripts = pgTable(
  'transcript',
  {
    id: text('id').primaryKey(),
    audioAssetId: text('audio_asset_id')
      .notNull()
      .references(() => audioAssets.id, { onDelete: 'cascade' }),
    rawText: text('raw_text').notNull(),
    confirmedText: text('confirmed_text'),
    status: transcriptStatus('status').notNull().default('pending'),
    language: text('language').notNull().default('zh-CN'),
    confidence: numeric('confidence', { precision: 5, scale: 4 }),
    provider: text('provider'),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('transcript_audio_asset_idx').on(table.audioAssetId, table.createdAt),
    check('transcript_confidence_range', sql`${table.confidence} is null or ${table.confidence} between 0 and 1`),
    check(
      'transcript_confirmed_consistency',
      sql`(${table.status} = 'confirmed') = (${table.confirmedText} is not null and ${table.confirmedAt} is not null)`,
    ),
  ],
);

export const audioAnalyses = pgTable(
  'audio_analysis',
  {
    id: text('id').primaryKey(),
    audioAssetId: text('audio_asset_id')
      .notNull()
      .references(() => audioAssets.id, { onDelete: 'cascade' }),
    voicedDurationMs: integer('voiced_duration_ms'),
    pauseRatio: numeric('pause_ratio', { precision: 5, scale: 4 }),
    speechRateCharsPerMin: integer('speech_rate_chars_per_min'),
    clarityScore: numeric('clarity_score', { precision: 5, scale: 4 }),
    emotionLabel: text('emotion_label'),
    emotionConfidence: numeric('emotion_confidence', { precision: 5, scale: 4 }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('audio_analysis_audio_asset_unique').on(table.audioAssetId),
    check('audio_analysis_pause_ratio_range', sql`${table.pauseRatio} is null or ${table.pauseRatio} between 0 and 1`),
    check(
      'audio_analysis_clarity_range',
      sql`${table.clarityScore} is null or ${table.clarityScore} between 0 and 1`,
    ),
    check(
      'audio_analysis_emotion_confidence_range',
      sql`${table.emotionConfidence} is null or ${table.emotionConfidence} between 0 and 1`,
    ),
    check(
      'audio_analysis_voiced_duration_positive',
      sql`${table.voicedDurationMs} is null or ${table.voicedDurationMs} > 0`,
    ),
  ],
);
