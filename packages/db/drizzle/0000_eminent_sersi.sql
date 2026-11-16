CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."answer_modality" AS ENUM('text', 'voice');--> statement-breakpoint
CREATE TYPE "public"."audio_asset_status" AS ENUM('uploaded', 'transcribing', 'transcribed', 'confirmed', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."dataset_group" AS ENUM('development', 'internal_validation', 'final_acceptance', 'scenario_branch');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('not_published', 'published', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."eval_case_source" AS ENUM('synthetic', 'consented');--> statement-breakpoint
CREATE TYPE "public"."eval_dataset_status" AS ENUM('draft', 'frozen', 'retired');--> statement-breakpoint
CREATE TYPE "public"."evaluation_dimension_key" AS ENUM('correctness', 'depth', 'logic', 'role_fit', 'communication', 'speech_acoustics', 'speech_emotion');--> statement-breakpoint
CREATE TYPE "public"."evidence_level" AS ENUM('self_reported', 'verifiable');--> statement-breakpoint
CREATE TYPE "public"."evidence_source" AS ENUM('interview', 'retest', 'diagnostic');--> statement-breakpoint
CREATE TYPE "public"."experiment_status" AS ENUM('created', 'running', 'evaluated', 'passed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."feedback_category" AS ENUM('question_quality', 'report_accuracy', 'audio_quality', 'agent_behavior', 'other');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('open', 'triaged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."interview_kind" AS ENUM('practice', 'retest');--> statement-breakpoint
CREATE TYPE "public"."interview_status" AS ENUM('planning', 'awaiting_answer', 'processing_answer', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."knowledge_review_decision" AS ENUM('approve', 'reject', 'deprecate');--> statement-breakpoint
CREATE TYPE "public"."learning_progress_status" AS ENUM('started', 'self_reported', 'verified', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."learning_resource_availability" AS ENUM('available', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."learning_resource_level" AS ENUM('intro', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."metric_scope" AS ENUM('system', 'role');--> statement-breakpoint
CREATE TYPE "public"."pair_eligibility" AS ENUM('pending', 'eligible', 'ineligible');--> statement-breakpoint
CREATE TYPE "public"."plan_action" AS ENUM('deepen', 'switch_skill', 'adjust_difficulty', 'finish');--> statement-breakpoint
CREATE TYPE "public"."policy_status" AS ENUM('baseline', 'candidate', 'champion', 'retired', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."prediction_status" AS ENUM('pending', 'paired', 'expired');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('technical', 'project', 'scenario', 'behavioral');--> statement-breakpoint
CREATE TYPE "public"."recommendation_action" AS ENUM('practice', 'review_resource', 'retest');--> statement-breakpoint
CREATE TYPE "public"."recommendation_status" AS ENUM('suggested', 'accepted', 'completed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."reflection_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('draft', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."run_attempt_status" AS ENUM('running', 'completed', 'failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."run_event_type" AS ENUM('run.accepted', 'run.stage', 'question.delta', 'question.completed', 'run.completed', 'run.failed', 'run.cancelled');--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('initial_plan', 'answer_processing', 'finish', 'reflection', 'experiment_evaluation', 'learning_recommendation');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."source_verification_status" AS ENUM('draft', 'pending', 'content-checked');--> statement-breakpoint
CREATE TYPE "public"."transcript_status" AS ENUM('pending', 'ready', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."interview_turn_status" AS ENUM('awaiting_answer', 'processing_answer', 'answered', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."xp_reason" AS ENUM('interview_completed', 'learning_completed', 'retest_completed', 'hint_used', 'admin_adjustment');--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"user_agent" text,
	"rotated_from_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_session_expiry_after_issue" CHECK ("auth_session"."expires_at" > "auth_session"."issued_at"),
	CONSTRAINT "auth_session_revoked_after_issue" CHECK ("auth_session"."revoked_at" is null or "auth_session"."revoked_at" >= "auth_session"."issued_at")
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" DEFAULT 'student' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"password_hash" text NOT NULL,
	"password_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_length" CHECK (char_length("app_user"."email") between 3 and 320),
	CONSTRAINT "app_user_display_name_length" CHECK (char_length("app_user"."display_name") between 1 and 80),
	CONSTRAINT "app_user_xp_non_negative" CHECK ("app_user"."xp" >= 0),
	CONSTRAINT "app_user_level_positive" CHECK ("app_user"."level" >= 1),
	CONSTRAINT "app_user_coins_non_negative" CHECK ("app_user"."coins" >= 0)
);
--> statement-breakpoint
CREATE TABLE "knowledge_item_source" (
	"knowledge_item_id" text NOT NULL,
	"source_id" text NOT NULL,
	CONSTRAINT "knowledge_item_source_pk" PRIMARY KEY("knowledge_item_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_item" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"question_type" "question_type" NOT NULL,
	"difficulty" smallint NOT NULL,
	"question" text NOT NULL,
	"key_points" jsonb NOT NULL,
	"rubric_id" text NOT NULL,
	"version" text NOT NULL,
	"review_status" "review_status" DEFAULT 'draft' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_item_difficulty_range" CHECK ("knowledge_item"."difficulty" between 1 and 5),
	CONSTRAINT "knowledge_item_question_not_blank" CHECK (char_length(btrim("knowledge_item"."question")) > 0),
	CONSTRAINT "knowledge_item_key_points_not_empty" CHECK (jsonb_array_length("knowledge_item"."key_points") > 0)
);
--> statement-breakpoint
CREATE TABLE "knowledge_review" (
	"id" text PRIMARY KEY NOT NULL,
	"knowledge_item_id" text NOT NULL,
	"decision" "knowledge_review_decision" NOT NULL,
	"from_status" "review_status" NOT NULL,
	"to_status" "review_status" NOT NULL,
	"reviewer_id" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_review_status_change" CHECK (("knowledge_review"."decision" = 'approve' and "knowledge_review"."from_status" = 'draft' and "knowledge_review"."to_status" = 'reviewed') or ("knowledge_review"."decision" = 'reject' and "knowledge_review"."to_status" = "knowledge_review"."from_status") or ("knowledge_review"."decision" = 'deprecate' and "knowledge_review"."to_status" = 'draft'))
);
--> statement-breakpoint
CREATE TABLE "knowledge_source" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"owner" text NOT NULL,
	"license_note" text NOT NULL,
	"retrieved_at" date,
	"last_checked_at" date,
	"verification_status" "source_verification_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_source_url_scheme" CHECK ("knowledge_source"."url" is null or "knowledge_source"."url" ~ '^https?://')
);
--> statement-breakpoint
CREATE TABLE "role_skill" (
	"role_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_skill_pk" PRIMARY KEY("role_id","skill_id"),
	CONSTRAINT "role_skill_skill_id_length" CHECK (char_length("role_skill"."skill_id") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"knowledge_version" text NOT NULL,
	"rubric_version" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_name_length" CHECK (char_length("role"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "rubric_criterion" (
	"rubric_id" text NOT NULL,
	"criterion_id" text NOT NULL,
	"description" text NOT NULL,
	"max_score" numeric(5, 2) NOT NULL,
	"weight" numeric(5, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rubric_criterion_pk" PRIMARY KEY("rubric_id","criterion_id"),
	CONSTRAINT "rubric_criterion_max_score_positive" CHECK ("rubric_criterion"."max_score" > 0),
	CONSTRAINT "rubric_criterion_weight_range" CHECK ("rubric_criterion"."weight" > 0 and "rubric_criterion"."weight" <= 1)
);
--> statement-breakpoint
CREATE TABLE "rubric" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"question_type" "question_type",
	"version" text NOT NULL,
	"review_status" "review_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rubric_version_length" CHECK (char_length("rubric"."version") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "policy_version" (
	"version" text PRIMARY KEY NOT NULL,
	"role_id" text,
	"skill_id" text,
	"status" "policy_status" DEFAULT 'candidate' NOT NULL,
	"parent_version" text,
	"parameters" jsonb NOT NULL,
	"change_reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	CONSTRAINT "policy_version_max_followup_depth" CHECK (("policy_version"."parameters" ->> 'maxFollowupDepth')::int between 1 and 5),
	CONSTRAINT "policy_version_uncertainty_boost" CHECK (("policy_version"."parameters" ->> 'uncertaintyPriorityBoost')::numeric between 0 and 1),
	CONSTRAINT "policy_version_coverage_reserve" CHECK (("policy_version"."parameters" ->> 'coverageReserveRatio')::numeric between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "audio_analysis" (
	"id" text PRIMARY KEY NOT NULL,
	"audio_asset_id" text NOT NULL,
	"voiced_duration_ms" integer,
	"pause_ratio" numeric(5, 4),
	"speech_rate_chars_per_min" integer,
	"clarity_score" numeric(5, 4),
	"emotion_label" text,
	"emotion_confidence" numeric(5, 4),
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_analysis_pause_ratio_range" CHECK ("audio_analysis"."pause_ratio" is null or "audio_analysis"."pause_ratio" between 0 and 1),
	CONSTRAINT "audio_analysis_clarity_range" CHECK ("audio_analysis"."clarity_score" is null or "audio_analysis"."clarity_score" between 0 and 1),
	CONSTRAINT "audio_analysis_emotion_confidence_range" CHECK ("audio_analysis"."emotion_confidence" is null or "audio_analysis"."emotion_confidence" between 0 and 1),
	CONSTRAINT "audio_analysis_voiced_duration_positive" CHECK ("audio_analysis"."voiced_duration_ms" is null or "audio_analysis"."voiced_duration_ms" > 0)
);
--> statement-breakpoint
CREATE TABLE "audio_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"interview_id" text NOT NULL,
	"turn_id" text,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"duration_ms" integer,
	"status" "audio_asset_status" DEFAULT 'uploaded' NOT NULL,
	"consent_for_review" boolean DEFAULT false NOT NULL,
	"retention_until" timestamp with time zone,
	"delete_requested_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_asset_byte_size_positive" CHECK ("audio_asset"."byte_size" > 0),
	CONSTRAINT "audio_asset_duration_positive" CHECK ("audio_asset"."duration_ms" is null or "audio_asset"."duration_ms" > 0),
	CONSTRAINT "audio_asset_retention_requires_consent" CHECK ("audio_asset"."retention_until" is null or "audio_asset"."consent_for_review"),
	CONSTRAINT "audio_asset_deleted_at_consistency" CHECK (("audio_asset"."status" = 'deleted') = ("audio_asset"."deleted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "interview_turn" (
	"id" text PRIMARY KEY NOT NULL,
	"interview_id" text NOT NULL,
	"seq" integer NOT NULL,
	"question_id" text,
	"question_text" text NOT NULL,
	"question_type" "question_type" NOT NULL,
	"skill_id" text NOT NULL,
	"difficulty" smallint NOT NULL,
	"status" "interview_turn_status" DEFAULT 'awaiting_answer' NOT NULL,
	"answer" text,
	"answer_modality" "answer_modality",
	"answer_transcript_id" text,
	"idempotency_key" text,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"answer_submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_turn_seq_non_negative" CHECK ("interview_turn"."seq" >= 0),
	CONSTRAINT "interview_turn_difficulty_range" CHECK ("interview_turn"."difficulty" between 1 and 5),
	CONSTRAINT "interview_turn_answer_length" CHECK ("interview_turn"."answer" is null or char_length("interview_turn"."answer") between 1 and 10000),
	CONSTRAINT "interview_turn_hints_non_negative" CHECK ("interview_turn"."hints_used" >= 0),
	CONSTRAINT "interview_turn_answer_consistency" CHECK (("interview_turn"."status" = 'answered') = ("interview_turn"."answer" is not null and "interview_turn"."answer_submitted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "interview_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"kind" "interview_kind" DEFAULT 'practice' NOT NULL,
	"retest_of_interview_id" text,
	"goal" text NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"status" "interview_status" DEFAULT 'planning' NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"policy_version" text DEFAULT 'baseline-v0' NOT NULL,
	"current_question_id" text,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure" jsonb,
	"deadline_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_session_goal_length" CHECK (char_length(btrim("interview_session"."goal")) between 1 and 500),
	CONSTRAINT "interview_session_duration_range" CHECK ("interview_session"."duration_minutes" between 15 and 25),
	CONSTRAINT "interview_session_version_non_negative" CHECK ("interview_session"."session_version" >= 0),
	CONSTRAINT "interview_session_retest_not_self" CHECK ("interview_session"."retest_of_interview_id" is null or "interview_session"."retest_of_interview_id" <> "interview_session"."id"),
	CONSTRAINT "interview_session_completed_at_consistency" CHECK (("interview_session"."status" = 'completed') = ("interview_session"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "transcript" (
	"id" text PRIMARY KEY NOT NULL,
	"audio_asset_id" text NOT NULL,
	"raw_text" text NOT NULL,
	"confirmed_text" text,
	"status" "transcript_status" DEFAULT 'pending' NOT NULL,
	"language" text DEFAULT 'zh-CN' NOT NULL,
	"confidence" numeric(5, 4),
	"provider" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_confidence_range" CHECK ("transcript"."confidence" is null or "transcript"."confidence" between 0 and 1),
	CONSTRAINT "transcript_confirmed_consistency" CHECK (("transcript"."status" = 'confirmed') = ("transcript"."confirmed_text" is not null and "transcript"."confirmed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" text PRIMARY KEY NOT NULL,
	"interview_id" text NOT NULL,
	"user_id" text NOT NULL,
	"turn_id" text,
	"kind" "run_kind" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"stage" text,
	"attempt_id" text,
	"attempt_count" smallint DEFAULT 0 NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"output" jsonb,
	"error" jsonb,
	"policy_version" text NOT NULL,
	"budget" jsonb DEFAULT '{"maxAttempts":2,"maxLlmCallsPerAttempt":3,"maxToolCallsPerAttempt":5,"deadlineMs":120000}'::jsonb NOT NULL,
	"deadline_at" timestamp with time zone,
	"last_event_seq" integer DEFAULT 0 NOT NULL,
	"cancel_requested_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_run_attempt_count_range" CHECK ("agent_run"."attempt_count" between 0 and 2),
	CONSTRAINT "agent_run_last_event_seq_non_negative" CHECK ("agent_run"."last_event_seq" >= 0),
	CONSTRAINT "agent_run_cancel_consistency" CHECK (("agent_run"."status" <> 'cancelled') or "agent_run"."cancelled_at" is not null),
	CONSTRAINT "agent_run_completed_consistency" CHECK (("agent_run"."status" <> 'completed') or "agent_run"."completed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "idempotency_record" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"route" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"interview_id" text,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_record_key_length" CHECK (char_length("idempotency_record"."idempotency_key") between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "plan_decision" (
	"id" text PRIMARY KEY NOT NULL,
	"interview_id" text NOT NULL,
	"run_id" text,
	"turn_id" text,
	"action" "plan_action" NOT NULL,
	"skill_id" text NOT NULL,
	"question_id" text,
	"rationale" text NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remaining_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_decision_rationale_length" CHECK (char_length(btrim("plan_decision"."rationale")) between 1 and 500),
	CONSTRAINT "plan_decision_remaining_seconds_non_negative" CHECK ("plan_decision"."remaining_seconds" is null or "plan_decision"."remaining_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "run_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"attempt_no" smallint NOT NULL,
	"status" "run_attempt_status" DEFAULT 'running' NOT NULL,
	"lease_until" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"provider" text,
	"model" text,
	"usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" jsonb,
	"terminal_reason" text,
	CONSTRAINT "run_attempt_no_range" CHECK ("run_attempt"."attempt_no" between 1 and 2),
	CONSTRAINT "run_attempt_terminal_ended_at" CHECK (("run_attempt"."status" = 'running') = ("run_attempt"."ended_at" is null))
);
--> statement-breakpoint
CREATE TABLE "run_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"attempt_id" text,
	"seq" integer NOT NULL,
	"type" "run_event_type" NOT NULL,
	"schema_version" smallint DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_event_seq_non_negative" CHECK ("run_event"."seq" >= 0),
	CONSTRAINT "run_event_schema_version_positive" CHECK ("run_event"."schema_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "evaluation_dimension" (
	"evaluation_id" text NOT NULL,
	"dimension" "evaluation_dimension_key" NOT NULL,
	"score" numeric(5, 4),
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	CONSTRAINT "evaluation_dimension_pk" PRIMARY KEY("evaluation_id","dimension"),
	CONSTRAINT "evaluation_dimension_score_range" CHECK ("evaluation_dimension"."score" is null or "evaluation_dimension"."score" between 0 and 1),
	CONSTRAINT "evaluation_dimension_missing_consistency" CHECK ("evaluation_dimension"."score" is not null or jsonb_array_length("evaluation_dimension"."evidence_refs") = 0)
);
--> statement-breakpoint
CREATE TABLE "evaluation" (
	"id" text PRIMARY KEY NOT NULL,
	"interview_id" text NOT NULL,
	"turn_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"question_id" text,
	"rubric_id" text,
	"rubric_version" text NOT NULL,
	"evaluator_version" text NOT NULL,
	"overall_score" numeric(5, 4),
	"confidence" numeric(5, 4) DEFAULT '0' NOT NULL,
	"missing_dimensions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_overall_range" CHECK ("evaluation"."overall_score" is null or "evaluation"."overall_score" between 0 and 1),
	CONSTRAINT "evaluation_confidence_range" CHECK ("evaluation"."confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "report_dimension" (
	"report_id" text NOT NULL,
	"dimension" "evaluation_dimension_key" NOT NULL,
	"score" numeric(5, 4),
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	CONSTRAINT "report_dimension_pk" PRIMARY KEY("report_id","dimension"),
	CONSTRAINT "report_dimension_score_range" CHECK ("report_dimension"."score" is null or "report_dimension"."score" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "interview_report" (
	"id" text PRIMARY KEY NOT NULL,
	"interview_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"rubric_version" text NOT NULL,
	"overall_score" numeric(5, 4),
	"summary" text,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"practice_advice" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_dimensions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_report_overall_range" CHECK ("interview_report"."overall_score" is null or "interview_report"."overall_score" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "skill_observation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"interview_id" text NOT NULL,
	"turn_id" text NOT NULL,
	"evaluation_id" text,
	"knowledge_item_id" text,
	"source" "evidence_source" NOT NULL,
	"independent_evidence" boolean DEFAULT true NOT NULL,
	"dedupe_key" text,
	"weight" numeric(5, 4) DEFAULT '1' NOT NULL,
	"mastery_before" numeric(5, 4),
	"mastery_after" numeric(5, 4),
	"confidence_before" numeric(5, 4),
	"confidence_after" numeric(5, 4),
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_observation_weight_range" CHECK ("skill_observation"."weight" > 0 and "skill_observation"."weight" <= 1),
	CONSTRAINT "skill_observation_mastery_range" CHECK (("skill_observation"."mastery_before" is null or "skill_observation"."mastery_before" between 0 and 1) and ("skill_observation"."mastery_after" is null or "skill_observation"."mastery_after" between 0 and 1)),
	CONSTRAINT "skill_observation_confidence_range" CHECK (("skill_observation"."confidence_before" is null or "skill_observation"."confidence_before" between 0 and 1) and ("skill_observation"."confidence_after" is null or "skill_observation"."confidence_after" between 0 and 1))
);
--> statement-breakpoint
CREATE TABLE "skill_profile" (
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"mastery" numeric(5, 4),
	"confidence" numeric(5, 4) DEFAULT '0' NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_evidence_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_profile_pk" PRIMARY KEY("user_id","role_id","skill_id"),
	CONSTRAINT "skill_profile_mastery_range" CHECK ("skill_profile"."mastery" is null or "skill_profile"."mastery" between 0 and 1),
	CONSTRAINT "skill_profile_confidence_range" CHECK ("skill_profile"."confidence" between 0 and 1),
	CONSTRAINT "skill_profile_evidence_count_non_negative" CHECK ("skill_profile"."evidence_count" >= 0),
	CONSTRAINT "skill_profile_version_positive" CHECK ("skill_profile"."version" >= 1),
	CONSTRAINT "skill_profile_evidence_consistency" CHECK ("skill_profile"."mastery" is null or "skill_profile"."evidence_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "learning_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"status" "learning_progress_status" DEFAULT 'started' NOT NULL,
	"evidence_level" "evidence_level",
	"evidence" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_progress_completion_consistency" CHECK (("learning_progress"."status" in ('self_reported', 'verified')) = ("learning_progress"."completed_at" is not null and "learning_progress"."evidence_level" is not null)),
	CONSTRAINT "learning_progress_evidence_level_match" CHECK (("learning_progress"."status" = 'self_reported' and "learning_progress"."evidence_level" = 'self_reported') or ("learning_progress"."status" = 'verified' and "learning_progress"."evidence_level" = 'verifiable') or ("learning_progress"."status" in ('started', 'abandoned') and "learning_progress"."evidence_level" is null))
);
--> statement-breakpoint
CREATE TABLE "learning_resource_skill" (
	"resource_id" text NOT NULL,
	"role_id" text NOT NULL,
	"skill_id" text NOT NULL,
	CONSTRAINT "learning_resource_skill_pk" PRIMARY KEY("resource_id","role_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "learning_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"provider" text NOT NULL,
	"level" "learning_resource_level" DEFAULT 'intermediate' NOT NULL,
	"estimated_minutes" integer,
	"last_checked_at" date,
	"review_status" "review_status" DEFAULT 'draft' NOT NULL,
	"availability" "learning_resource_availability" DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_resource_url_scheme" CHECK ("learning_resource"."url" ~ '^https?://'),
	CONSTRAINT "learning_resource_estimated_minutes_positive" CHECK ("learning_resource"."estimated_minutes" is null or "learning_resource"."estimated_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "recommendation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"interview_id" text,
	"report_id" text,
	"resource_id" text,
	"action" "recommendation_action" NOT NULL,
	"rationale" text NOT NULL,
	"status" "recommendation_status" DEFAULT 'suggested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_rationale_not_blank" CHECK (char_length(btrim("recommendation"."rationale")) > 0),
	CONSTRAINT "recommendation_resource_requirement" CHECK ("recommendation"."action" <> 'review_resource' or "recommendation"."resource_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "performance_pair" (
	"id" text PRIMARY KEY NOT NULL,
	"prediction_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"retest_interview_id" text,
	"predicted_score" numeric(5, 4) NOT NULL,
	"reference_score" numeric(5, 4),
	"mae" numeric(5, 4),
	"eligibility" "pair_eligibility" DEFAULT 'pending' NOT NULL,
	"ineligibility_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"difficulty" smallint,
	"rubric_version" text NOT NULL,
	"learning_exposure_matched" boolean DEFAULT false NOT NULL,
	"paired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performance_pair_predicted_range" CHECK ("performance_pair"."predicted_score" between 0 and 1),
	CONSTRAINT "performance_pair_reference_range" CHECK ("performance_pair"."reference_score" is null or "performance_pair"."reference_score" between 0 and 1),
	CONSTRAINT "performance_pair_mae_non_negative" CHECK ("performance_pair"."mae" is null or "performance_pair"."mae" >= 0),
	CONSTRAINT "performance_pair_eligible_requires_reference" CHECK ("performance_pair"."eligibility" <> 'eligible' or ("performance_pair"."reference_score" is not null and "performance_pair"."mae" is not null and "performance_pair"."learning_exposure_matched" and "performance_pair"."retest_interview_id" is not null)),
	CONSTRAINT "performance_pair_ineligible_reasons" CHECK ("performance_pair"."eligibility" <> 'ineligible' or jsonb_array_length("performance_pair"."ineligibility_reasons") > 0)
);
--> statement-breakpoint
CREATE TABLE "prediction_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"source_interview_id" text,
	"predicted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_learning_exposure" text NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"rubric_version" text NOT NULL,
	"predicted_target_score" numeric(5, 4) NOT NULL,
	"predictor_version" text NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "prediction_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prediction_snapshot_score_range" CHECK ("prediction_snapshot"."predicted_target_score" between 0 and 1),
	CONSTRAINT "prediction_snapshot_window" CHECK ("prediction_snapshot"."valid_until" > "prediction_snapshot"."predicted_at"),
	CONSTRAINT "prediction_snapshot_exposure_not_blank" CHECK (char_length(btrim("prediction_snapshot"."expected_learning_exposure")) > 0)
);
--> statement-breakpoint
CREATE TABLE "reflection" (
	"id" text PRIMARY KEY NOT NULL,
	"interview_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"status" "reflection_status" DEFAULT 'pending' NOT NULL,
	"skill_coverage" numeric(5, 4),
	"repeat_rate" numeric(5, 4),
	"plan_adherence" numeric(5, 4),
	"longest_skill_run" integer,
	"objectives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"new_evidence_count" integer DEFAULT 0 NOT NULL,
	"duplicate_question_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missed_skill_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uncertainty" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text,
	"candidate_policy_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "reflection_skill_coverage_range" CHECK ("reflection"."skill_coverage" is null or "reflection"."skill_coverage" between 0 and 1),
	CONSTRAINT "reflection_repeat_rate_range" CHECK ("reflection"."repeat_rate" is null or "reflection"."repeat_rate" between 0 and 1),
	CONSTRAINT "reflection_plan_adherence_range" CHECK ("reflection"."plan_adherence" is null or "reflection"."plan_adherence" between 0 and 1),
	CONSTRAINT "reflection_longest_run_non_negative" CHECK ("reflection"."longest_skill_run" is null or "reflection"."longest_skill_run" >= 0),
	CONSTRAINT "reflection_completed_consistency" CHECK (("reflection"."status" = 'completed') = ("reflection"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "eval_case" (
	"id" text PRIMARY KEY NOT NULL,
	"dataset_id" text NOT NULL,
	"role_id" text NOT NULL,
	"skill_id" text,
	"source" "eval_case_source" DEFAULT 'synthetic' NOT NULL,
	"input" jsonb NOT NULL,
	"expected" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_dataset" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role_id" text NOT NULL,
	"version" text NOT NULL,
	"group" "dataset_group" NOT NULL,
	"status" "eval_dataset_status" DEFAULT 'draft' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"frozen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_dataset_item_count_non_negative" CHECK ("eval_dataset"."item_count" >= 0),
	CONSTRAINT "eval_dataset_frozen_consistency" CHECK (("eval_dataset"."status" = 'frozen') = ("eval_dataset"."frozen_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "eval_experiment" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"baseline_policy_version" text NOT NULL,
	"candidate_policy_version" text NOT NULL,
	"dataset_id" text NOT NULL,
	"status" "experiment_status" DEFAULT 'created' NOT NULL,
	"deployment_status" "deployment_status" DEFAULT 'not_published' NOT NULL,
	"thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_summary" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"evaluated_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"rolled_back_at" timestamp with time zone,
	"rollback_reason" text,
	CONSTRAINT "eval_experiment_distinct_policies" CHECK ("eval_experiment"."baseline_policy_version" <> "eval_experiment"."candidate_policy_version"),
	CONSTRAINT "eval_experiment_published_requires_approval" CHECK ("eval_experiment"."deployment_status" <> 'published' or ("eval_experiment"."approved_at" is not null and "eval_experiment"."approved_by" is not null)),
	CONSTRAINT "eval_experiment_rollback_consistency" CHECK ("eval_experiment"."deployment_status" <> 'rolled_back' or ("eval_experiment"."rolled_back_at" is not null and "eval_experiment"."rollback_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "experiment_case_result" (
	"id" text PRIMARY KEY NOT NULL,
	"experiment_id" text NOT NULL,
	"case_id" text NOT NULL,
	"baseline_score" numeric(5, 4),
	"candidate_score" numeric(5, 4),
	"hit" boolean,
	"excluded" boolean DEFAULT false NOT NULL,
	"exclusion_reason" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiment_case_result_score_range" CHECK (("experiment_case_result"."baseline_score" is null or "experiment_case_result"."baseline_score" between 0 and 1) and ("experiment_case_result"."candidate_score" is null or "experiment_case_result"."candidate_score" between 0 and 1)),
	CONSTRAINT "experiment_case_result_exclusion_reason" CHECK (("experiment_case_result"."excluded" = false and "experiment_case_result"."exclusion_reason" is null) or ("experiment_case_result"."excluded" = true and char_length(btrim("experiment_case_result"."exclusion_reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "policy_champion" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"skill_id" text,
	"policy_version" text NOT NULL,
	"previous_policy_version" text,
	"activated_by_experiment_id" text,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rolled_back_at" timestamp with time zone,
	"rollback_reason" text,
	CONSTRAINT "policy_champion_rollback_consistency" CHECK ("policy_champion"."rolled_back_at" is null or ("policy_champion"."rollback_reason" is not null and "policy_champion"."previous_policy_version" is not null))
);
--> statement-breakpoint
CREATE TABLE "alert" (
	"id" text PRIMARY KEY NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"source" text NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"status" "alert_status" DEFAULT 'open' NOT NULL,
	"interview_id" text,
	"run_id" text,
	"experiment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "alert_source_values" CHECK ("alert"."source" in ('api', 'agent', 'evaluation', 'speech', 'budget')),
	CONSTRAINT "alert_acknowledged_consistency" CHECK (("alert"."status" in ('acknowledged', 'resolved')) = ("alert"."acknowledged_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"actor_role" "user_role",
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"outcome" text NOT NULL,
	"request_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_outcome_values" CHECK ("audit_log"."outcome" in ('success', 'failure'))
);
--> statement-breakpoint
CREATE TABLE "feedback_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"interview_id" text,
	"run_id" text,
	"category" "feedback_category" NOT NULL,
	"rating" smallint,
	"message" text,
	"status" "feedback_status" DEFAULT 'open' NOT NULL,
	"admin_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "feedback_entry_rating_range" CHECK ("feedback_entry"."rating" is null or "feedback_entry"."rating" between 1 and 5),
	CONSTRAINT "feedback_entry_message_length" CHECK ("feedback_entry"."message" is null or char_length("feedback_entry"."message") between 1 and 2000),
	CONSTRAINT "feedback_entry_resolved_consistency" CHECK (("feedback_entry"."status" = 'resolved') = ("feedback_entry"."resolved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "metric_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" "metric_scope" NOT NULL,
	"role_id" text,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"interview_count" integer DEFAULT 0 NOT NULL,
	"completed_interview_count" integer DEFAULT 0 NOT NULL,
	"run_failure_rate" numeric(5, 4),
	"skill_coverage" numeric(5, 4),
	"repeat_rate" numeric(5, 4),
	"plan_adherence" numeric(5, 4),
	"longest_skill_run" integer,
	"p95_latency_ms" integer,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_snapshot_window_order" CHECK ("metric_snapshot"."window_end" > "metric_snapshot"."window_start"),
	CONSTRAINT "metric_snapshot_scope_role" CHECK (("metric_snapshot"."scope" = 'role') = ("metric_snapshot"."role_id" is not null)),
	CONSTRAINT "metric_snapshot_ratio_ranges" CHECK (("metric_snapshot"."run_failure_rate" is null or "metric_snapshot"."run_failure_rate" between 0 and 1) and ("metric_snapshot"."skill_coverage" is null or "metric_snapshot"."skill_coverage" between 0 and 1) and ("metric_snapshot"."repeat_rate" is null or "metric_snapshot"."repeat_rate" between 0 and 1) and ("metric_snapshot"."plan_adherence" is null or "metric_snapshot"."plan_adherence" between 0 and 1)),
	CONSTRAINT "metric_snapshot_counts_non_negative" CHECK ("metric_snapshot"."interview_count" >= 0 and "metric_snapshot"."completed_interview_count" >= 0 and "metric_snapshot"."sample_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "xp_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"reason" "xp_reason" NOT NULL,
	"xp_delta" integer DEFAULT 0 NOT NULL,
	"coin_delta" integer DEFAULT 0 NOT NULL,
	"balance_xp" integer NOT NULL,
	"balance_coins" integer NOT NULL,
	"level_after" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_event_has_change" CHECK ("xp_event"."xp_delta" <> 0 or "xp_event"."coin_delta" <> 0),
	CONSTRAINT "xp_event_reason_direction" CHECK (("xp_event"."reason" = 'hint_used' and "xp_event"."coin_delta" < 0) or ("xp_event"."reason" <> 'hint_used' and "xp_event"."xp_delta" >= 0 and "xp_event"."coin_delta" >= 0)),
	CONSTRAINT "xp_event_balances_non_negative" CHECK ("xp_event"."balance_xp" >= 0 and "xp_event"."balance_coins" >= 0 and "xp_event"."level_after" >= 1)
);
--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_source" ADD CONSTRAINT "knowledge_item_source_knowledge_item_id_knowledge_item_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_source" ADD CONSTRAINT "knowledge_item_source_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item" ADD CONSTRAINT "knowledge_item_rubric_id_rubric_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubric"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item" ADD CONSTRAINT "knowledge_item_reviewed_by_app_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item" ADD CONSTRAINT "knowledge_item_role_skill_fk" FOREIGN KEY ("role_id","skill_id") REFERENCES "public"."role_skill"("role_id","skill_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_review" ADD CONSTRAINT "knowledge_review_knowledge_item_id_knowledge_item_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_review" ADD CONSTRAINT "knowledge_review_reviewer_id_app_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_skill" ADD CONSTRAINT "role_skill_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criterion" ADD CONSTRAINT "rubric_criterion_rubric_id_rubric_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubric"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric" ADD CONSTRAINT "rubric_role_skill_fk" FOREIGN KEY ("role_id","skill_id") REFERENCES "public"."role_skill"("role_id","skill_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_version" ADD CONSTRAINT "policy_version_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_version" ADD CONSTRAINT "policy_version_parent_version_policy_version_version_fk" FOREIGN KEY ("parent_version") REFERENCES "public"."policy_version"("version") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_version" ADD CONSTRAINT "policy_version_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_analysis" ADD CONSTRAINT "audio_analysis_audio_asset_id_audio_asset_id_fk" FOREIGN KEY ("audio_asset_id") REFERENCES "public"."audio_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_asset" ADD CONSTRAINT "audio_asset_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_asset" ADD CONSTRAINT "audio_asset_interview_id_interview_session_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_asset" ADD CONSTRAINT "audio_asset_turn_id_interview_turn_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."interview_turn"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_turn" ADD CONSTRAINT "interview_turn_interview_id_interview_session_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_turn" ADD CONSTRAINT "interview_turn_question_id_knowledge_item_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."knowledge_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_turn" ADD CONSTRAINT "interview_turn_answer_transcript_id_transcript_id_fk" FOREIGN KEY ("answer_transcript_id") REFERENCES "public"."transcript"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_session" ADD CONSTRAINT "interview_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_session" ADD CONSTRAINT "interview_session_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_session" ADD CONSTRAINT "interview_session_policy_version_policy_version_version_fk" FOREIGN KEY ("policy_version") REFERENCES "public"."policy_version"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_session" ADD CONSTRAINT "interview_session_current_question_id_knowledge_item_id_fk" FOREIGN KEY ("current_question_id") REFERENCES "public"."knowledge_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_session" ADD CONSTRAINT "interview_session_retest_fk" FOREIGN KEY ("retest_of_interview_id") REFERENCES "public"."interview_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript" ADD CONSTRAINT "transcript_audio_asset_id_audio_asset_id_fk" FOREIGN KEY ("audio_asset_id") REFERENCES "public"."audio_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_interview_id_interview_session_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_turn_id_interview_turn_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."interview_turn"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_policy_version_policy_version_version_fk" FOREIGN KEY ("policy_version") REFERENCES "public"."policy_version"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_interview_id_interview_session_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_decision" ADD CONSTRAINT "plan_decision_interview_id_interview_session_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_decision" ADD CONSTRAINT "plan_decision_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_decision" ADD CONSTRAINT "plan_decision_turn_id_interview_turn_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."interview_turn"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_decision" ADD CONSTRAINT "plan_decision_question_id_knowledge_item_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."knowledge_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_attempt" ADD CONSTRAINT "run_attempt_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_event" ADD CONSTRAINT "run_event_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_event" ADD CONSTRAINT "run_event_attempt_id_run_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."run_attempt"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_dimension" ADD CONSTRAINT "evaluation_dimension_evaluation_id_evaluation_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation" ADD CONSTRAINT "evaluation_interview_id_interview_session_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation" ADD CONSTRAINT "evaluation_turn_id_interview_turn_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."interview_turn"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation" ADD CONSTRAINT "evaluation_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation" ADD CONSTRAINT "evaluation_question_id_knowledge_item_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."knowledge_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation" ADD CONSTRAINT "evaluation_rubric_id_rubric_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubric"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation" ADD CONSTRAINT "evaluation_role_skill_fk" FOREIGN KEY ("role_id","skill_id") REFERENCES "public"."role_skill"("role_id","skill_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dimension" ADD CONSTRAINT "report_dimension_report_id_interview_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."interview_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_report" ADD CONSTRAINT "interview_report_interview_id_interview_session_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_report" ADD CONSTRAINT "interview_report_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_report" ADD CONSTRAINT "interview_report_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_observation" ADD CONSTRAINT "skill_observation_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_observation" ADD CONSTRAINT "skill_observation_interview_id_interview_session_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_observation" ADD CONSTRAINT "skill_observation_turn_id_interview_turn_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."interview_turn"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_observation" ADD CONSTRAINT "skill_observation_evaluation_id_evaluation_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_observation" ADD CONSTRAINT "skill_observation_knowledge_item_id_knowledge_item_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_observation" ADD CONSTRAINT "skill_observation_role_skill_fk" FOREIGN KEY ("role_id","skill_id") REFERENCES "public"."role_skill"("role_id","skill_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_profile" ADD CONSTRAINT "skill_profile_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_profile" ADD CONSTRAINT "skill_profile_role_skill_fk" FOREIGN KEY ("role_id","skill_id") REFERENCES "public"."role_skill"("role_id","skill_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_resource_id_learning_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."learning_resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_resource_skill" ADD CONSTRAINT "learning_resource_skill_resource_id_learning_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."learning_resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_resource_skill" ADD CONSTRAINT "learning_resource_skill_role_fk" FOREIGN KEY ("role_id","skill_id") REFERENCES "public"."role_skill"("role_id","skill_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_resource" ADD CONSTRAINT "learning_resource_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_interview_id_interview_session_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_report_id_interview_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."interview_report"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_resource_id_learning_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."learning_resource"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_role_skill_fk" FOREIGN KEY ("role_id","skill_id") REFERENCES "public"."role_skill"("role_id","skill_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_pair" ADD CONSTRAINT "performance_pair_prediction_id_prediction_snapshot_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."prediction_snapshot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_pair" ADD CONSTRAINT "performance_pair_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_pair" ADD CONSTRAINT "performance_pair_retest_interview_id_interview_session_id_fk" FOREIGN KEY ("retest_interview_id") REFERENCES "public"."interview_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_pair" ADD CONSTRAINT "performance_pair_role_skill_fk" FOREIGN KEY ("role_id","skill_id") REFERENCES "public"."role_skill"("role_id","skill_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_snapshot" ADD CONSTRAINT "prediction_snapshot_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_snapshot" ADD CONSTRAINT "prediction_snapshot_source_interview_id_interview_session_id_fk" FOREIGN KEY ("source_interview_id") REFERENCES "public"."interview_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_snapshot" ADD CONSTRAINT "prediction_snapshot_role_skill_fk" FOREIGN KEY ("role_id","skill_id") REFERENCES "public"."role_skill"("role_id","skill_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflection" ADD CONSTRAINT "reflection_interview_id_interview_session_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflection" ADD CONSTRAINT "reflection_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflection" ADD CONSTRAINT "reflection_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflection" ADD CONSTRAINT "reflection_candidate_policy_version_policy_version_version_fk" FOREIGN KEY ("candidate_policy_version") REFERENCES "public"."policy_version"("version") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_case" ADD CONSTRAINT "eval_case_dataset_id_eval_dataset_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."eval_dataset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_case" ADD CONSTRAINT "eval_case_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_dataset" ADD CONSTRAINT "eval_dataset_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_experiment" ADD CONSTRAINT "eval_experiment_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_experiment" ADD CONSTRAINT "eval_experiment_dataset_id_eval_dataset_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."eval_dataset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_experiment" ADD CONSTRAINT "eval_experiment_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_experiment" ADD CONSTRAINT "eval_experiment_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_experiment" ADD CONSTRAINT "eval_experiment_baseline_policy_fk" FOREIGN KEY ("baseline_policy_version") REFERENCES "public"."policy_version"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_experiment" ADD CONSTRAINT "eval_experiment_candidate_policy_fk" FOREIGN KEY ("candidate_policy_version") REFERENCES "public"."policy_version"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_case_result" ADD CONSTRAINT "experiment_case_result_experiment_id_eval_experiment_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."eval_experiment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_case_result" ADD CONSTRAINT "experiment_case_result_case_id_eval_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eval_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_champion" ADD CONSTRAINT "policy_champion_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_champion" ADD CONSTRAINT "policy_champion_policy_version_policy_version_version_fk" FOREIGN KEY ("policy_version") REFERENCES "public"."policy_version"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_champion" ADD CONSTRAINT "policy_champion_previous_policy_fk" FOREIGN KEY ("previous_policy_version") REFERENCES "public"."policy_version"("version") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_champion" ADD CONSTRAINT "policy_champion_experiment_fk" FOREIGN KEY ("activated_by_experiment_id") REFERENCES "public"."eval_experiment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_interview_id_interview_session_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_experiment_id_eval_experiment_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."eval_experiment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_entry" ADD CONSTRAINT "feedback_entry_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_entry" ADD CONSTRAINT "feedback_entry_interview_id_interview_session_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_entry" ADD CONSTRAINT "feedback_entry_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshot" ADD CONSTRAINT "metric_snapshot_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_event" ADD CONSTRAINT "xp_event_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_session_token_hash_unique" ON "auth_session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_family_idx" ON "auth_session" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_unique" ON "app_user" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "app_user_role_idx" ON "app_user" USING btree ("role");--> statement-breakpoint
CREATE INDEX "knowledge_item_source_source_idx" ON "knowledge_item_source" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "knowledge_item_scope_idx" ON "knowledge_item" USING btree ("role_id","skill_id","review_status");--> statement-breakpoint
CREATE INDEX "knowledge_item_role_type_idx" ON "knowledge_item" USING btree ("role_id","question_type");--> statement-breakpoint
CREATE INDEX "knowledge_review_item_idx" ON "knowledge_review" USING btree ("knowledge_item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_scope_version_unique" ON "rubric" USING btree ("role_id","skill_id","version");--> statement-breakpoint
CREATE INDEX "rubric_role_idx" ON "rubric" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "policy_version_status_idx" ON "policy_version" USING btree ("status");--> statement-breakpoint
CREATE INDEX "policy_version_role_idx" ON "policy_version" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audio_analysis_audio_asset_unique" ON "audio_analysis" USING btree ("audio_asset_id");--> statement-breakpoint
CREATE INDEX "audio_asset_interview_idx" ON "audio_asset" USING btree ("interview_id");--> statement-breakpoint
CREATE INDEX "audio_asset_user_idx" ON "audio_asset" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_turn_seq_unique" ON "interview_turn" USING btree ("interview_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_turn_idempotency_unique" ON "interview_turn" USING btree ("interview_id","idempotency_key") WHERE "interview_turn"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "interview_turn_interview_idx" ON "interview_turn" USING btree ("interview_id","seq");--> statement-breakpoint
CREATE INDEX "interview_session_user_created_idx" ON "interview_session" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "interview_session_user_status_idx" ON "interview_session" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "interview_session_role_idx" ON "interview_session" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "transcript_audio_asset_idx" ON "transcript" USING btree ("audio_asset_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_run_interview_idx" ON "agent_run" USING btree ("interview_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_run_status_idx" ON "agent_run" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_record_scope_unique" ON "idempotency_record" USING btree ("user_id","route","idempotency_key");--> statement-breakpoint
CREATE INDEX "plan_decision_interview_idx" ON "plan_decision" USING btree ("interview_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "run_attempt_no_unique" ON "run_attempt" USING btree ("run_id","attempt_no");--> statement-breakpoint
CREATE INDEX "run_attempt_run_idx" ON "run_attempt" USING btree ("run_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "run_event_seq_unique" ON "run_event" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "run_event_replay_idx" ON "run_event" USING btree ("run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_turn_unique" ON "evaluation" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "evaluation_interview_idx" ON "evaluation" USING btree ("interview_id");--> statement-breakpoint
CREATE INDEX "evaluation_skill_idx" ON "evaluation" USING btree ("user_id","role_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_report_interview_unique" ON "interview_report" USING btree ("interview_id");--> statement-breakpoint
CREATE INDEX "interview_report_user_idx" ON "interview_report" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "skill_observation_skill_idx" ON "skill_observation" USING btree ("user_id","role_id","skill_id","observed_at");--> statement-breakpoint
CREATE INDEX "skill_observation_interview_idx" ON "skill_observation" USING btree ("interview_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_observation_dedupe_unique" ON "skill_observation" USING btree ("dedupe_key") WHERE "skill_observation"."dedupe_key" is not null and "skill_observation"."independent_evidence";--> statement-breakpoint
CREATE INDEX "skill_profile_role_idx" ON "skill_profile" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE INDEX "learning_progress_user_idx" ON "learning_progress" USING btree ("user_id","resource_id");--> statement-breakpoint
CREATE INDEX "learning_resource_skill_scope_idx" ON "learning_resource_skill" USING btree ("role_id","skill_id");--> statement-breakpoint
CREATE INDEX "learning_resource_role_idx" ON "learning_resource" USING btree ("role_id","review_status");--> statement-breakpoint
CREATE INDEX "recommendation_user_skill_idx" ON "recommendation" USING btree ("user_id","role_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "performance_pair_prediction_unique" ON "performance_pair" USING btree ("prediction_id");--> statement-breakpoint
CREATE INDEX "performance_pair_role_eligibility_idx" ON "performance_pair" USING btree ("role_id","eligibility");--> statement-breakpoint
CREATE INDEX "prediction_snapshot_skill_idx" ON "prediction_snapshot" USING btree ("user_id","role_id","skill_id","valid_until");--> statement-breakpoint
CREATE INDEX "prediction_snapshot_status_idx" ON "prediction_snapshot" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "reflection_interview_unique" ON "reflection" USING btree ("interview_id");--> statement-breakpoint
CREATE INDEX "reflection_user_idx" ON "reflection" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "eval_case_dataset_idx" ON "eval_case" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "eval_case_skill_idx" ON "eval_case" USING btree ("role_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_dataset_scope_unique" ON "eval_dataset" USING btree ("role_id","name","version");--> statement-breakpoint
CREATE INDEX "eval_dataset_group_idx" ON "eval_dataset" USING btree ("role_id","group");--> statement-breakpoint
CREATE INDEX "eval_experiment_role_idx" ON "eval_experiment" USING btree ("role_id","created_at");--> statement-breakpoint
CREATE INDEX "eval_experiment_status_idx" ON "eval_experiment" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_case_result_unique" ON "experiment_case_result" USING btree ("experiment_id","case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_champion_scope_unique" ON "policy_champion" USING btree ("role_id",coalesce("skill_id", '')) WHERE "policy_champion"."rolled_back_at" is null;--> statement-breakpoint
CREATE INDEX "policy_champion_role_idx" ON "policy_champion" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "alert_status_idx" ON "alert" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "alert_severity_idx" ON "alert" USING btree ("severity","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "feedback_entry_status_idx" ON "feedback_entry" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "metric_snapshot_window_idx" ON "metric_snapshot" USING btree ("scope","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_event_dedupe_unique" ON "xp_event" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "xp_event_user_idx" ON "xp_event" USING btree ("user_id","created_at");