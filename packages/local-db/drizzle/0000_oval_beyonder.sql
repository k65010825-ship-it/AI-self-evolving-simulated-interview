CREATE TABLE `skill_observation` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`rubric_version` text,
	`dimension` text,
	`score` real,
	`evidence` text DEFAULT '{}' NOT NULL,
	`observed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "skill_observation_source_type_values" CHECK("skill_observation"."source_type" in ('interview', 'retest', 'diagnostic')),
	CONSTRAINT "skill_observation_score_range" CHECK("skill_observation"."score" is null or "skill_observation"."score" between 0 and 1)
);
--> statement-breakpoint
CREATE INDEX `skill_observation_scope_idx` ON `skill_observation` (`user_id`,`role_id`,`skill_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `skill_profile` (
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`mastery` real,
	`confidence` real DEFAULT 0 NOT NULL,
	`evidence_count` integer DEFAULT 0 NOT NULL,
	`last_updated_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `role_id`, `skill_id`),
	CONSTRAINT "skill_profile_mastery_range" CHECK("skill_profile"."mastery" is null or "skill_profile"."mastery" between 0 and 1),
	CONSTRAINT "skill_profile_confidence_range" CHECK("skill_profile"."confidence" between 0 and 1),
	CONSTRAINT "skill_profile_evidence_non_negative" CHECK("skill_profile"."evidence_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE `user_gamification` (
	`user_id` text PRIMARY KEY NOT NULL,
	`xp_balance` integer DEFAULT 0 NOT NULL,
	`coin_balance` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "user_gamification_balances_non_negative" CHECK("user_gamification"."xp_balance" >= 0 and "user_gamification"."coin_balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE `xp_event` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`xp_delta` integer DEFAULT 0 NOT NULL,
	`coin_delta` integer DEFAULT 0 NOT NULL,
	`balance_xp` integer NOT NULL,
	`balance_coins` integer NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "xp_event_reason_values" CHECK("xp_event"."reason" in ('interview_completed', 'learning_completed', 'retest_completed', 'hint_used', 'admin_adjustment')),
	CONSTRAINT "xp_event_has_change" CHECK("xp_event"."xp_delta" <> 0 or "xp_event"."coin_delta" <> 0),
	CONSTRAINT "xp_event_reason_direction" CHECK(("xp_event"."reason" = 'hint_used' and "xp_event"."coin_delta" < 0) or ("xp_event"."reason" <> 'hint_used' and "xp_event"."xp_delta" >= 0 and "xp_event"."coin_delta" >= 0)),
	CONSTRAINT "xp_event_balances_non_negative" CHECK("xp_event"."balance_xp" >= 0 and "xp_event"."balance_coins" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `xp_event_dedupe_unique` ON `xp_event` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `xp_event_user_idx` ON `xp_event` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `audio_analysis` (
	`id` text PRIMARY KEY NOT NULL,
	`audio_asset_id` text NOT NULL,
	`voiced_duration_ms` integer,
	`pause_ratio` real,
	`speech_rate_chars_per_min` integer,
	`clarity_score` real,
	`clarity_verified` integer DEFAULT false NOT NULL,
	`emotion_label` text,
	`emotion_confidence` real,
	`emotion_verified` integer DEFAULT false NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`evidence` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "audio_analysis_pause_ratio_range" CHECK("audio_analysis"."pause_ratio" is null or "audio_analysis"."pause_ratio" between 0 and 1),
	CONSTRAINT "audio_analysis_clarity_range" CHECK("audio_analysis"."clarity_score" is null or "audio_analysis"."clarity_score" between 0 and 1),
	CONSTRAINT "audio_analysis_emotion_confidence_range" CHECK("audio_analysis"."emotion_confidence" is null or "audio_analysis"."emotion_confidence" between 0 and 1),
	CONSTRAINT "audio_analysis_voiced_duration_positive" CHECK("audio_analysis"."voiced_duration_ms" is null or "audio_analysis"."voiced_duration_ms" > 0),
	CONSTRAINT "audio_analysis_clarity_verified_requires_score" CHECK("audio_analysis"."clarity_verified" = false or "audio_analysis"."clarity_score" is not null),
	CONSTRAINT "audio_analysis_emotion_verified_requires_score" CHECK("audio_analysis"."emotion_verified" = false or "audio_analysis"."emotion_confidence" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audio_analysis_audio_asset_unique` ON `audio_analysis` (`audio_asset_id`);--> statement-breakpoint
CREATE TABLE `audio_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`interview_id` text NOT NULL,
	`turn_id` text,
	`storage_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`duration_ms` integer,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`consent_for_review` integer DEFAULT false NOT NULL,
	`retention_until` integer,
	`delete_requested_at` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "audio_asset_status_values" CHECK("audio_asset"."status" in ('uploaded', 'transcribing', 'transcribed', 'confirmed', 'failed', 'deleted')),
	CONSTRAINT "audio_asset_byte_size_positive" CHECK("audio_asset"."byte_size" > 0),
	CONSTRAINT "audio_asset_duration_positive" CHECK("audio_asset"."duration_ms" is null or "audio_asset"."duration_ms" > 0),
	CONSTRAINT "audio_asset_retention_requires_consent" CHECK("audio_asset"."retention_until" is null or "audio_asset"."consent_for_review"),
	CONSTRAINT "audio_asset_deleted_at_consistency" CHECK(("audio_asset"."status" = 'deleted') = ("audio_asset"."deleted_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `audio_asset_interview_idx` ON `audio_asset` (`interview_id`);--> statement-breakpoint
CREATE INDEX `audio_asset_user_idx` ON `audio_asset` (`user_id`);--> statement-breakpoint
CREATE TABLE `interview_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`kind` text DEFAULT 'practice' NOT NULL,
	`retest_of_interview_id` text,
	`goal` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`status` text DEFAULT 'planning' NOT NULL,
	`session_version` integer DEFAULT 0 NOT NULL,
	`policy_version` text DEFAULT 'baseline-v0' NOT NULL,
	`current_question_id` text,
	`state` text DEFAULT '{}' NOT NULL,
	`failure` text,
	`deadline_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`cancel_reason` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "interview_session_status_values" CHECK("interview_session"."status" in ('planning', 'awaiting_answer', 'processing_answer', 'completed', 'cancelled', 'failed')),
	CONSTRAINT "interview_session_kind_values" CHECK("interview_session"."kind" in ('practice', 'retest')),
	CONSTRAINT "interview_session_goal_length" CHECK(length(trim("interview_session"."goal")) between 1 and 500),
	CONSTRAINT "interview_session_duration_range" CHECK("interview_session"."duration_minutes" between 15 and 25),
	CONSTRAINT "interview_session_version_non_negative" CHECK("interview_session"."session_version" >= 0),
	CONSTRAINT "interview_session_retest_not_self" CHECK("interview_session"."retest_of_interview_id" is null or "interview_session"."retest_of_interview_id" <> "interview_session"."id"),
	CONSTRAINT "interview_session_completed_at_consistency" CHECK(("interview_session"."status" = 'completed') = ("interview_session"."completed_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `interview_session_user_created_idx` ON `interview_session` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `interview_session_user_status_idx` ON `interview_session` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `interview_session_role_idx` ON `interview_session` (`role_id`);--> statement-breakpoint
CREATE TABLE `interview_turn` (
	`id` text PRIMARY KEY NOT NULL,
	`interview_id` text NOT NULL,
	`seq` integer NOT NULL,
	`question_id` text,
	`question_text` text NOT NULL,
	`question_type` text NOT NULL,
	`skill_id` text NOT NULL,
	`difficulty` integer NOT NULL,
	`status` text DEFAULT 'awaiting_answer' NOT NULL,
	`answer` text,
	`answer_modality` text,
	`answer_transcript_id` text,
	`idempotency_key` text,
	`hints_used` integer DEFAULT 0 NOT NULL,
	`answer_submitted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "interview_turn_status_values" CHECK("interview_turn"."status" in ('awaiting_answer', 'processing_answer', 'answered', 'skipped')),
	CONSTRAINT "interview_turn_question_type_values" CHECK("interview_turn"."question_type" in ('technical', 'project', 'scenario', 'behavioral')),
	CONSTRAINT "interview_turn_answer_modality_values" CHECK("interview_turn"."answer_modality" is null or "interview_turn"."answer_modality" in ('text', 'voice')),
	CONSTRAINT "interview_turn_seq_non_negative" CHECK("interview_turn"."seq" >= 0),
	CONSTRAINT "interview_turn_difficulty_range" CHECK("interview_turn"."difficulty" between 1 and 5),
	CONSTRAINT "interview_turn_answer_length" CHECK("interview_turn"."answer" is null or length("interview_turn"."answer") between 1 and 10000),
	CONSTRAINT "interview_turn_hints_non_negative" CHECK("interview_turn"."hints_used" >= 0),
	CONSTRAINT "interview_turn_answer_consistency" CHECK(("interview_turn"."status" = 'answered') = ("interview_turn"."answer" is not null and "interview_turn"."answer_submitted_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interview_turn_seq_unique` ON `interview_turn` (`interview_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `interview_turn_idempotency_unique` ON `interview_turn` (`interview_id`,`idempotency_key`) WHERE "interview_turn"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX `interview_turn_interview_idx` ON `interview_turn` (`interview_id`,`seq`);--> statement-breakpoint
CREATE TABLE `transcript` (
	`id` text PRIMARY KEY NOT NULL,
	`audio_asset_id` text NOT NULL,
	`raw_text` text NOT NULL,
	`confirmed_text` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`language` text DEFAULT 'zh-CN' NOT NULL,
	`confidence` real,
	`provider` text,
	`model` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`confirmed_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "transcript_status_values" CHECK("transcript"."status" in ('pending', 'ready', 'confirmed', 'failed')),
	CONSTRAINT "transcript_confidence_range" CHECK("transcript"."confidence" is null or "transcript"."confidence" between 0 and 1),
	CONSTRAINT "transcript_confirmed_consistency" CHECK(("transcript"."status" = 'confirmed') = ("transcript"."confirmed_text" is not null and "transcript"."confirmed_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `transcript_audio_asset_idx` ON `transcript` (`audio_asset_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_run` (
	`id` text PRIMARY KEY NOT NULL,
	`interview_id` text NOT NULL,
	`user_id` text NOT NULL,
	`turn_id` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`stage` text,
	`attempt_id` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`input_snapshot` text NOT NULL,
	`output` text,
	`error` text,
	`policy_version` text NOT NULL,
	`budget` text DEFAULT '{"maxAttempts":2,"maxLlmCallsPerAttempt":3,"maxToolCallsPerAttempt":5,"deadlineMs":120000}' NOT NULL,
	`deadline_at` integer,
	`last_event_seq` integer DEFAULT 0 NOT NULL,
	`cancel_requested_at` integer,
	`cancelled_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "agent_run_status_values" CHECK("agent_run"."status" in ('queued', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "agent_run_kind_values" CHECK("agent_run"."kind" in ('initial_plan', 'answer_processing', 'finish', 'reflection', 'experiment_evaluation', 'learning_recommendation')),
	CONSTRAINT "agent_run_attempt_count_range" CHECK("agent_run"."attempt_count" between 0 and 2),
	CONSTRAINT "agent_run_last_event_seq_non_negative" CHECK("agent_run"."last_event_seq" >= 0),
	CONSTRAINT "agent_run_cancel_consistency" CHECK(("agent_run"."status" <> 'cancelled') or "agent_run"."cancelled_at" is not null),
	CONSTRAINT "agent_run_completed_consistency" CHECK(("agent_run"."status" <> 'completed') or "agent_run"."completed_at" is not null)
);
--> statement-breakpoint
CREATE INDEX `agent_run_interview_idx` ON `agent_run` (`interview_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_run_status_idx` ON `agent_run` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `budget_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`attempt_id` text,
	`operation` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`llm_calls` integer DEFAULT 0 NOT NULL,
	`tool_calls` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`settled_at` integer,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "budget_ledger_operation_values" CHECK("budget_ledger"."operation" in ('reserve', 'dispatch', 'settle', 'unknown')),
	CONSTRAINT "budget_ledger_status_values" CHECK("budget_ledger"."status" in ('open', 'settled', 'unknown')),
	CONSTRAINT "budget_ledger_amounts_non_negative" CHECK("budget_ledger"."llm_calls" >= 0 and "budget_ledger"."tool_calls" >= 0 and "budget_ledger"."input_tokens" >= 0 and "budget_ledger"."output_tokens" >= 0),
	CONSTRAINT "budget_ledger_settled_consistency" CHECK(("budget_ledger"."status" = 'settled') = ("budget_ledger"."settled_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `budget_ledger_run_idx` ON `budget_ledger` (`run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `idempotency_record` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`route` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`interview_id` text,
	`run_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "idempotency_record_key_length" CHECK(length("idempotency_record"."idempotency_key") between 1 and 128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_record_scope_unique` ON `idempotency_record` (`user_id`,`route`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `plan_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`interview_id` text NOT NULL,
	`run_id` text,
	`turn_id` text,
	`action` text NOT NULL,
	`skill_id` text NOT NULL,
	`question_id` text,
	`rationale` text NOT NULL,
	`evidence_refs` text DEFAULT '[]' NOT NULL,
	`remaining_seconds` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "plan_decision_action_values" CHECK("plan_decision"."action" in ('deepen', 'switch_skill', 'adjust_difficulty', 'finish')),
	CONSTRAINT "plan_decision_rationale_length" CHECK(length(trim("plan_decision"."rationale")) between 1 and 500),
	CONSTRAINT "plan_decision_remaining_seconds_non_negative" CHECK("plan_decision"."remaining_seconds" is null or "plan_decision"."remaining_seconds" >= 0)
);
--> statement-breakpoint
CREATE INDEX `plan_decision_interview_idx` ON `plan_decision` (`interview_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `run_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`attempt_no` integer NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`lease_until` integer,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ended_at` integer,
	`provider` text,
	`model` text,
	`usage` text DEFAULT '{}' NOT NULL,
	`error` text,
	`terminal_reason` text,
	CONSTRAINT "run_attempt_status_values" CHECK("run_attempt"."status" in ('running', 'completed', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "run_attempt_no_range" CHECK("run_attempt"."attempt_no" between 1 and 2),
	CONSTRAINT "run_attempt_terminal_ended_at" CHECK(("run_attempt"."status" = 'running') = ("run_attempt"."ended_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_attempt_no_unique` ON `run_attempt` (`run_id`,`attempt_no`);--> statement-breakpoint
CREATE INDEX `run_attempt_run_idx` ON `run_attempt` (`run_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `run_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`attempt_id` text,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`occurred_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "run_event_type_values" CHECK("run_event"."type" in ('run.accepted', 'run.stage', 'question.delta', 'question.completed', 'run.completed', 'run.failed', 'run.cancelled')),
	CONSTRAINT "run_event_seq_non_negative" CHECK("run_event"."seq" >= 0),
	CONSTRAINT "run_event_schema_version_positive" CHECK("run_event"."schema_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_event_seq_unique` ON `run_event` (`run_id`,`seq`);--> statement-breakpoint
CREATE INDEX `run_event_replay_idx` ON `run_event` (`run_id`,`seq`);--> statement-breakpoint
CREATE TABLE `evaluation_dimension` (
	`evaluation_id` text NOT NULL,
	`dimension` text NOT NULL,
	`status` text DEFAULT 'scored' NOT NULL,
	`score` real,
	`evidence_refs` text DEFAULT '[]' NOT NULL,
	`note` text,
	PRIMARY KEY(`evaluation_id`, `dimension`),
	CONSTRAINT "evaluation_dimension_values" CHECK("evaluation_dimension"."dimension" in ('correctness', 'depth', 'logic', 'role_fit', 'communication', 'speech_acoustics', 'speech_emotion')),
	CONSTRAINT "evaluation_dimension_status_values" CHECK("evaluation_dimension"."status" in ('scored', 'zero', 'missing_evidence', 'abstained')),
	CONSTRAINT "evaluation_dimension_score_range" CHECK("evaluation_dimension"."score" is null or "evaluation_dimension"."score" between 0 and 1),
	CONSTRAINT "evaluation_dimension_scored_has_score" CHECK("evaluation_dimension"."status" <> 'scored' or "evaluation_dimension"."score" is not null),
	CONSTRAINT "evaluation_dimension_zero_score" CHECK("evaluation_dimension"."status" <> 'zero' or "evaluation_dimension"."score" = 0),
	CONSTRAINT "evaluation_dimension_unscored_null" CHECK("evaluation_dimension"."status" not in ('missing_evidence', 'abstained') or ("evaluation_dimension"."score" is null and "evaluation_dimension"."evidence_refs" = '[]'))
);
--> statement-breakpoint
CREATE TABLE `evaluation` (
	`id` text PRIMARY KEY NOT NULL,
	`interview_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`question_id` text,
	`rubric_id` text,
	`rubric_version` text NOT NULL,
	`evaluator_version` text NOT NULL,
	`scoring_status` text DEFAULT 'scored' NOT NULL,
	`overall_score` real,
	`confidence` real DEFAULT 0 NOT NULL,
	`missing_dimensions` text DEFAULT '[]' NOT NULL,
	`strengths` text DEFAULT '[]' NOT NULL,
	`gaps` text DEFAULT '[]' NOT NULL,
	`evidence` text DEFAULT '{}' NOT NULL,
	`answer_digest` text,
	`answer_version` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "evaluation_scoring_status_values" CHECK("evaluation"."scoring_status" in ('scored', 'partial', 'skipped')),
	CONSTRAINT "evaluation_overall_range" CHECK("evaluation"."overall_score" is null or "evaluation"."overall_score" between 0 and 1),
	CONSTRAINT "evaluation_confidence_range" CHECK("evaluation"."confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evaluation_turn_unique` ON `evaluation` (`turn_id`);--> statement-breakpoint
CREATE INDEX `evaluation_interview_idx` ON `evaluation` (`interview_id`);--> statement-breakpoint
CREATE INDEX `evaluation_skill_idx` ON `evaluation` (`user_id`,`role_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `report_dimension` (
	`report_id` text NOT NULL,
	`dimension` text NOT NULL,
	`score` real,
	`evidence_refs` text DEFAULT '[]' NOT NULL,
	`note` text,
	PRIMARY KEY(`report_id`, `dimension`),
	CONSTRAINT "report_dimension_values" CHECK("report_dimension"."dimension" in ('correctness', 'depth', 'logic', 'role_fit', 'communication', 'speech_acoustics', 'speech_emotion')),
	CONSTRAINT "report_dimension_score_range" CHECK("report_dimension"."score" is null or "report_dimension"."score" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE `interview_report` (
	`id` text PRIMARY KEY NOT NULL,
	`interview_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`policy_version` text NOT NULL,
	`rubric_version` text NOT NULL,
	`overall_score` real,
	`summary` text,
	`strengths` text DEFAULT '[]' NOT NULL,
	`gaps` text DEFAULT '[]' NOT NULL,
	`practice_advice` text DEFAULT '[]' NOT NULL,
	`missing_dimensions` text DEFAULT '[]' NOT NULL,
	`generated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "interview_report_overall_range" CHECK("interview_report"."overall_score" is null or "interview_report"."overall_score" between 0 and 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interview_report_interview_unique` ON `interview_report` (`interview_id`);--> statement-breakpoint
CREATE INDEX `interview_report_user_idx` ON `interview_report` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `learning_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`status` text DEFAULT 'started' NOT NULL,
	`evidence_level` text,
	`evidence` text,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "learning_progress_status_values" CHECK("learning_progress"."status" in ('started', 'self_reported', 'verified', 'abandoned')),
	CONSTRAINT "learning_progress_evidence_level_values" CHECK("learning_progress"."evidence_level" is null or "learning_progress"."evidence_level" in ('self_reported', 'verifiable')),
	CONSTRAINT "learning_progress_completion_consistency" CHECK(("learning_progress"."status" in ('self_reported', 'verified')) = ("learning_progress"."completed_at" is not null and "learning_progress"."evidence_level" is not null)),
	CONSTRAINT "learning_progress_evidence_level_match" CHECK(("learning_progress"."status" = 'self_reported' and "learning_progress"."evidence_level" = 'self_reported') or ("learning_progress"."status" = 'verified' and "learning_progress"."evidence_level" = 'verifiable') or ("learning_progress"."status" in ('started', 'abandoned') and "learning_progress"."evidence_level" is null))
);
--> statement-breakpoint
CREATE INDEX `learning_progress_user_idx` ON `learning_progress` (`user_id`,`resource_id`);--> statement-breakpoint
CREATE TABLE `recommendation` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`interview_id` text,
	`report_id` text,
	`resource_id` text,
	`action` text NOT NULL,
	`rationale` text NOT NULL,
	`status` text DEFAULT 'suggested' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "recommendation_action_values" CHECK("recommendation"."action" in ('practice', 'review_resource', 'retest')),
	CONSTRAINT "recommendation_status_values" CHECK("recommendation"."status" in ('suggested', 'accepted', 'completed', 'dismissed')),
	CONSTRAINT "recommendation_rationale_not_blank" CHECK(length(trim("recommendation"."rationale")) > 0),
	CONSTRAINT "recommendation_resource_requirement" CHECK("recommendation"."action" <> 'review_resource' or "recommendation"."resource_id" is not null)
);
--> statement-breakpoint
CREATE INDEX `recommendation_user_skill_idx` ON `recommendation` (`user_id`,`role_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `performance_pair` (
	`id` text PRIMARY KEY NOT NULL,
	`prediction_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`retest_interview_id` text,
	`predicted_score` real NOT NULL,
	`reference_score` real,
	`mae` real,
	`eligibility` text DEFAULT 'pending' NOT NULL,
	`ineligibility_reasons` text DEFAULT '[]' NOT NULL,
	`difficulty` integer,
	`rubric_version` text NOT NULL,
	`learning_exposure_matched` integer DEFAULT false NOT NULL,
	`paired_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "performance_pair_eligibility_values" CHECK("performance_pair"."eligibility" in ('pending', 'eligible', 'ineligible')),
	CONSTRAINT "performance_pair_predicted_range" CHECK("performance_pair"."predicted_score" between 0 and 1),
	CONSTRAINT "performance_pair_reference_range" CHECK("performance_pair"."reference_score" is null or "performance_pair"."reference_score" between 0 and 1),
	CONSTRAINT "performance_pair_mae_non_negative" CHECK("performance_pair"."mae" is null or "performance_pair"."mae" >= 0),
	CONSTRAINT "performance_pair_eligible_requires_reference" CHECK("performance_pair"."eligibility" <> 'eligible' or ("performance_pair"."reference_score" is not null and "performance_pair"."mae" is not null and "performance_pair"."learning_exposure_matched" and "performance_pair"."retest_interview_id" is not null)),
	CONSTRAINT "performance_pair_ineligible_reasons" CHECK("performance_pair"."eligibility" <> 'ineligible' or json_array_length("performance_pair"."ineligibility_reasons") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `performance_pair_prediction_unique` ON `performance_pair` (`prediction_id`);--> statement-breakpoint
CREATE INDEX `performance_pair_role_eligibility_idx` ON `performance_pair` (`role_id`,`eligibility`);--> statement-breakpoint
CREATE TABLE `prediction_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`source_interview_id` text,
	`predicted_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expected_learning_exposure` text NOT NULL,
	`valid_until` integer NOT NULL,
	`rubric_version` text NOT NULL,
	`predicted_target_score` real NOT NULL,
	`predictor_version` text NOT NULL,
	`evidence_refs` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "prediction_snapshot_status_values" CHECK("prediction_snapshot"."status" in ('pending', 'paired', 'expired')),
	CONSTRAINT "prediction_snapshot_score_range" CHECK("prediction_snapshot"."predicted_target_score" between 0 and 1),
	CONSTRAINT "prediction_snapshot_window" CHECK("prediction_snapshot"."valid_until" > "prediction_snapshot"."predicted_at"),
	CONSTRAINT "prediction_snapshot_exposure_not_blank" CHECK(length(trim("prediction_snapshot"."expected_learning_exposure")) > 0)
);
--> statement-breakpoint
CREATE INDEX `prediction_snapshot_skill_idx` ON `prediction_snapshot` (`user_id`,`role_id`,`skill_id`,`valid_until`);--> statement-breakpoint
CREATE INDEX `prediction_snapshot_status_idx` ON `prediction_snapshot` (`status`);--> statement-breakpoint
CREATE TABLE `reflection` (
	`id` text PRIMARY KEY NOT NULL,
	`interview_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`skill_coverage` real,
	`repeat_rate` real,
	`plan_adherence` real,
	`longest_skill_run` integer,
	`objectives` text DEFAULT '[]' NOT NULL,
	`new_evidence_count` integer DEFAULT 0 NOT NULL,
	`duplicate_question_ids` text DEFAULT '[]' NOT NULL,
	`missed_skill_ids` text DEFAULT '[]' NOT NULL,
	`uncertainty` text DEFAULT '{}' NOT NULL,
	`timing` text DEFAULT '{}' NOT NULL,
	`summary` text,
	`candidate_policy_version` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	CONSTRAINT "reflection_status_values" CHECK("reflection"."status" in ('pending', 'completed', 'failed')),
	CONSTRAINT "reflection_skill_coverage_range" CHECK("reflection"."skill_coverage" is null or "reflection"."skill_coverage" between 0 and 1),
	CONSTRAINT "reflection_repeat_rate_range" CHECK("reflection"."repeat_rate" is null or "reflection"."repeat_rate" between 0 and 1),
	CONSTRAINT "reflection_plan_adherence_range" CHECK("reflection"."plan_adherence" is null or "reflection"."plan_adherence" between 0 and 1),
	CONSTRAINT "reflection_longest_run_non_negative" CHECK("reflection"."longest_skill_run" is null or "reflection"."longest_skill_run" >= 0),
	CONSTRAINT "reflection_completed_consistency" CHECK(("reflection"."status" = 'completed') = ("reflection"."completed_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reflection_interview_unique` ON `reflection` (`interview_id`);--> statement-breakpoint
CREATE INDEX `reflection_user_idx` ON `reflection` (`user_id`,`created_at`);