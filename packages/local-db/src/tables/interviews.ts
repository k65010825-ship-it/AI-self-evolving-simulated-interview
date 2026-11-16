import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const nowMs = sql`(unixepoch() * 1000)`;

export const interviewSessions = sqliteTable(
  'interview_session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    roleId: text('role_id').notNull(),
    kind: text('kind').notNull().default('practice'),
    retestOfInterviewId: text('retest_of_interview_id'),
    goal: text('goal').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    status: text('status').notNull().default('planning'),
    sessionVersion: integer('session_version').notNull().default(0),
    policyVersion: text('policy_version').notNull().default('baseline-v0'),
    currentQuestionId: text('current_question_id'),
    state: text('state', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    failure: text('failure', { mode: 'json' }).$type<Record<string, unknown>>(),
    deadlineAt: integer('deadline_at', { mode: 'timestamp_ms' }),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    cancelReason: text('cancel_reason'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    index('interview_session_user_created_idx').on(table.userId, table.createdAt),
    index('interview_session_user_status_idx').on(table.userId, table.status),
    index('interview_session_role_idx').on(table.roleId),
    check(
      'interview_session_status_values',
      sql`${table.status} in ('planning', 'awaiting_answer', 'processing_answer', 'completed', 'cancelled', 'failed')`,
    ),
    check('interview_session_kind_values', sql`${table.kind} in ('practice', 'retest')`),
    check('interview_session_goal_length', sql`length(trim(${table.goal})) between 1 and 500`),
    check('interview_session_duration_range', sql`${table.durationMinutes} between 15 and 25`),
    check('interview_session_version_non_negative', sql`${table.sessionVersion} >= 0`),
    check('interview_session_retest_not_self', sql`${table.retestOfInterviewId} is null or ${table.retestOfInterviewId} <> ${table.id}`),
    check(
      'interview_session_completed_at_consistency',
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null)`,
    ),
  ],
);

export const interviewTurns = sqliteTable(
  'interview_turn',
  {
    id: text('id').primaryKey(),
    interviewId: text('interview_id').notNull(),
    seq: integer('seq').notNull(),
    questionId: text('question_id'),
    questionText: text('question_text').notNull(),
    questionType: text('question_type').notNull(),
    skillId: text('skill_id').notNull(),
    difficulty: integer('difficulty').notNull(),
    status: text('status').notNull().default('awaiting_answer'),
    answer: text('answer'),
    answerModality: text('answer_modality'),
    answerTranscriptId: text('answer_transcript_id'),
    idempotencyKey: text('idempotency_key'),
    hintsUsed: integer('hints_used').notNull().default(0),
    answerSubmittedAt: integer('answer_submitted_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('interview_turn_seq_unique').on(table.interviewId, table.seq),
    uniqueIndex('interview_turn_idempotency_unique')
      .on(table.interviewId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index('interview_turn_interview_idx').on(table.interviewId, table.seq),
    check(
      'interview_turn_status_values',
      sql`${table.status} in ('awaiting_answer', 'processing_answer', 'answered', 'skipped')`,
    ),
    check(
      'interview_turn_question_type_values',
      sql`${table.questionType} in ('technical', 'project', 'scenario', 'behavioral')`,
    ),
    check('interview_turn_answer_modality_values', sql`${table.answerModality} is null or ${table.answerModality} in ('text', 'voice')`),
    check('interview_turn_seq_non_negative', sql`${table.seq} >= 0`),
    check('interview_turn_difficulty_range', sql`${table.difficulty} between 1 and 5`),
    check('interview_turn_answer_length', sql`${table.answer} is null or length(${table.answer}) between 1 and 10000`),
    check('interview_turn_hints_non_negative', sql`${table.hintsUsed} >= 0`),
    check(
      'interview_turn_answer_consistency',
      sql`(${table.status} = 'answered') = (${table.answer} is not null and ${table.answerSubmittedAt} is not null)`,
    ),
  ],
);

export const audioAssets = sqliteTable(
  'audio_asset',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    interviewId: text('interview_id').notNull(),
    turnId: text('turn_id'),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    durationMs: integer('duration_ms'),
    status: text('status').notNull().default('uploaded'),
    consentForReview: integer('consent_for_review', { mode: 'boolean' }).notNull().default(false),
    retentionUntil: integer('retention_until', { mode: 'timestamp_ms' }),
    deleteRequestedAt: integer('delete_requested_at', { mode: 'timestamp_ms' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    index('audio_asset_interview_idx').on(table.interviewId),
    index('audio_asset_user_idx').on(table.userId),
    check(
      'audio_asset_status_values',
      sql`${table.status} in ('uploaded', 'transcribing', 'transcribed', 'confirmed', 'failed', 'deleted')`,
    ),
    check('audio_asset_byte_size_positive', sql`${table.byteSize} > 0`),
    check('audio_asset_duration_positive', sql`${table.durationMs} is null or ${table.durationMs} > 0`),
    check('audio_asset_retention_requires_consent', sql`${table.retentionUntil} is null or ${table.consentForReview}`),
    check('audio_asset_deleted_at_consistency', sql`(${table.status} = 'deleted') = (${table.deletedAt} is not null)`),
  ],
);

export const transcripts = sqliteTable(
  'transcript',
  {
    id: text('id').primaryKey(),
    audioAssetId: text('audio_asset_id').notNull(),
    rawText: text('raw_text').notNull(),
    confirmedText: text('confirmed_text'),
    status: text('status').notNull().default('pending'),
    language: text('language').notNull().default('zh-CN'),
    confidence: real('confidence'),
    provider: text('provider'),
    model: text('model'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    confirmedAt: integer('confirmed_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    index('transcript_audio_asset_idx').on(table.audioAssetId, table.createdAt),
    check('transcript_status_values', sql`${table.status} in ('pending', 'ready', 'confirmed', 'failed')`),
    check('transcript_confidence_range', sql`${table.confidence} is null or ${table.confidence} between 0 and 1`),
    check(
      'transcript_confirmed_consistency',
      sql`(${table.status} = 'confirmed') = (${table.confirmedText} is not null and ${table.confirmedAt} is not null)`,
    ),
  ],
);

export const audioAnalyses = sqliteTable(
  'audio_analysis',
  {
    id: text('id').primaryKey(),
    audioAssetId: text('audio_asset_id').notNull(),
    voicedDurationMs: integer('voiced_duration_ms'),
    pauseRatio: real('pause_ratio'),
    speechRateCharsPerMin: integer('speech_rate_chars_per_min'),
    clarityScore: real('clarity_score'),
    clarityVerified: integer('clarity_verified', { mode: 'boolean' }).notNull().default(false),
    emotionLabel: text('emotion_label'),
    emotionConfidence: real('emotion_confidence'),
    emotionVerified: integer('emotion_verified', { mode: 'boolean' }).notNull().default(false),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    evidence: text('evidence', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex('audio_analysis_audio_asset_unique').on(table.audioAssetId),
    check('audio_analysis_pause_ratio_range', sql`${table.pauseRatio} is null or ${table.pauseRatio} between 0 and 1`),
    check('audio_analysis_clarity_range', sql`${table.clarityScore} is null or ${table.clarityScore} between 0 and 1`),
    check('audio_analysis_emotion_confidence_range', sql`${table.emotionConfidence} is null or ${table.emotionConfidence} between 0 and 1`),
    check('audio_analysis_voiced_duration_positive', sql`${table.voicedDurationMs} is null or ${table.voicedDurationMs} > 0`),
    check('audio_analysis_clarity_verified_requires_score', sql`${table.clarityVerified} = false or ${table.clarityScore} is not null`),
    check('audio_analysis_emotion_verified_requires_score', sql`${table.emotionVerified} = false or ${table.emotionConfidence} is not null`),
  ],
);