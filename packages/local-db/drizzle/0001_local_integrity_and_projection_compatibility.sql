PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_xp_event` (
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
	FOREIGN KEY (`user_id`) REFERENCES `user_gamification`(`user_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "xp_event_reason_values" CHECK("__new_xp_event"."reason" in ('interview_completed', 'learning_completed', 'retest_completed', 'hint_used', 'admin_adjustment')),
	CONSTRAINT "xp_event_has_change" CHECK("__new_xp_event"."xp_delta" <> 0 or "__new_xp_event"."coin_delta" <> 0),
	CONSTRAINT "xp_event_reason_direction" CHECK(("__new_xp_event"."reason" = 'hint_used' and "__new_xp_event"."xp_delta" = 0 and "__new_xp_event"."coin_delta" < 0) or ("__new_xp_event"."reason" <> 'hint_used' and "__new_xp_event"."xp_delta" >= 0 and "__new_xp_event"."coin_delta" >= 0)),
	CONSTRAINT "xp_event_balances_non_negative" CHECK("__new_xp_event"."balance_xp" >= 0 and "__new_xp_event"."balance_coins" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_xp_event`("id", "user_id", "reason", "xp_delta", "coin_delta", "balance_xp", "balance_coins", "source_type", "source_id", "dedupe_key", "note", "created_at") SELECT "id", "user_id", "reason", "xp_delta", "coin_delta", "balance_xp", "balance_coins", "source_type", "source_id", "dedupe_key", "note", "created_at" FROM `xp_event`;--> statement-breakpoint
DROP TABLE `xp_event`;--> statement-breakpoint
ALTER TABLE `__new_xp_event` RENAME TO `xp_event`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `xp_event_dedupe_unique` ON `xp_event` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `xp_event_user_idx` ON `xp_event` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_agent_run` (
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
	FOREIGN KEY (`interview_id`) REFERENCES `interview_session`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`turn_id`) REFERENCES `interview_turn`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`attempt_id`) REFERENCES `run_attempt`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_run_status_values" CHECK("__new_agent_run"."status" in ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
	CONSTRAINT "agent_run_kind_values" CHECK("__new_agent_run"."kind" in ('initial_plan', 'answer_processing', 'finish', 'reflection', 'experiment_evaluation', 'learning_recommendation')),
	CONSTRAINT "agent_run_attempt_count_range" CHECK("__new_agent_run"."attempt_count" between 0 and 2),
	CONSTRAINT "agent_run_last_event_seq_non_negative" CHECK("__new_agent_run"."last_event_seq" >= 0),
	CONSTRAINT "agent_run_cancel_consistency" CHECK(("__new_agent_run"."status" <> 'cancelled') or "__new_agent_run"."cancelled_at" is not null),
	CONSTRAINT "agent_run_completed_consistency" CHECK(("__new_agent_run"."status" <> 'completed') or "__new_agent_run"."completed_at" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_agent_run`("id", "interview_id", "user_id", "turn_id", "kind", "status", "stage", "attempt_id", "attempt_count", "input_snapshot", "output", "error", "policy_version", "budget", "deadline_at", "last_event_seq", "cancel_requested_at", "cancelled_at", "completed_at", "created_at", "updated_at") SELECT "id", "interview_id", "user_id", "turn_id", "kind", "status", "stage", "attempt_id", "attempt_count", "input_snapshot", "output", "error", "policy_version", "budget", "deadline_at", "last_event_seq", "cancel_requested_at", "cancelled_at", "completed_at", "created_at", "updated_at" FROM `agent_run`;--> statement-breakpoint
DROP TABLE `agent_run`;--> statement-breakpoint
ALTER TABLE `__new_agent_run` RENAME TO `agent_run`;--> statement-breakpoint
CREATE INDEX `agent_run_interview_idx` ON `agent_run` (`interview_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_run_status_idx` ON `agent_run` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_run_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`attempt_id` text,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`occurred_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`attempt_id`) REFERENCES `run_attempt`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "run_event_type_values" CHECK("__new_run_event"."type" in ('run.accepted', 'run.stage', 'question.delta', 'question.completed', 'run.completed', 'run.failed', 'run.cancelled', 'local.event')),
	CONSTRAINT "run_event_seq_non_negative" CHECK("__new_run_event"."seq" >= 0),
	CONSTRAINT "run_event_schema_version_positive" CHECK("__new_run_event"."schema_version" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_run_event`("id", "run_id", "attempt_id", "seq", "type", "schema_version", "payload", "occurred_at", "created_at") SELECT "id", "run_id", "attempt_id", "seq", "type", "schema_version", "payload", "occurred_at", "created_at" FROM `run_event`;--> statement-breakpoint
DROP TABLE `run_event`;--> statement-breakpoint
ALTER TABLE `__new_run_event` RENAME TO `run_event`;--> statement-breakpoint
CREATE UNIQUE INDEX `run_event_seq_unique` ON `run_event` (`run_id`,`seq`);--> statement-breakpoint
CREATE INDEX `run_event_replay_idx` ON `run_event` (`run_id`,`seq`);--> statement-breakpoint
CREATE TABLE `__new_evaluation_dimension` (
	`evaluation_id` text NOT NULL,
	`dimension` text NOT NULL,
	`status` text DEFAULT 'scored' NOT NULL,
	`score` real,
	`evidence_refs` text DEFAULT '[]' NOT NULL,
	`note` text,
	PRIMARY KEY(`evaluation_id`, `dimension`),
	FOREIGN KEY (`evaluation_id`) REFERENCES `evaluation`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "evaluation_dimension_values" CHECK("__new_evaluation_dimension"."dimension" in ('correctness', 'depth', 'logic', 'role_fit', 'communication', 'speech_acoustics', 'speech_emotion')),
	CONSTRAINT "evaluation_dimension_status_values" CHECK("__new_evaluation_dimension"."status" in ('scored', 'zero', 'missing_evidence', 'abstained')),
	CONSTRAINT "evaluation_dimension_score_range" CHECK("__new_evaluation_dimension"."score" is null or "__new_evaluation_dimension"."score" between 0 and 1),
	CONSTRAINT "evaluation_dimension_scored_has_score" CHECK("__new_evaluation_dimension"."status" <> 'scored' or "__new_evaluation_dimension"."score" is not null),
	CONSTRAINT "evaluation_dimension_zero_score" CHECK("__new_evaluation_dimension"."status" <> 'zero' or ("__new_evaluation_dimension"."score" is not null and "__new_evaluation_dimension"."score" = 0)),
	CONSTRAINT "evaluation_dimension_unscored_null" CHECK("__new_evaluation_dimension"."status" not in ('missing_evidence', 'abstained') or ("__new_evaluation_dimension"."score" is null and "__new_evaluation_dimension"."evidence_refs" = '[]'))
);
--> statement-breakpoint
INSERT INTO `__new_evaluation_dimension`("evaluation_id", "dimension", "status", "score", "evidence_refs", "note") SELECT "evaluation_id", "dimension", "status", "score", "evidence_refs", "note" FROM `evaluation_dimension`;--> statement-breakpoint
DROP TABLE `evaluation_dimension`;--> statement-breakpoint
ALTER TABLE `__new_evaluation_dimension` RENAME TO `evaluation_dimension`;--> statement-breakpoint
CREATE TABLE `__new_performance_pair` (
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
	FOREIGN KEY (`prediction_id`) REFERENCES `prediction_snapshot`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`retest_interview_id`) REFERENCES `interview_session`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "performance_pair_eligibility_values" CHECK("__new_performance_pair"."eligibility" in ('pending', 'eligible', 'ineligible')),
	CONSTRAINT "performance_pair_predicted_range" CHECK("__new_performance_pair"."predicted_score" between 0 and 1),
	CONSTRAINT "performance_pair_reference_range" CHECK("__new_performance_pair"."reference_score" is null or "__new_performance_pair"."reference_score" between 0 and 1),
	CONSTRAINT "performance_pair_mae_range" CHECK("__new_performance_pair"."mae" is null or "__new_performance_pair"."mae" between 0 and 1),
	CONSTRAINT "performance_pair_eligible_requires_reference" CHECK("__new_performance_pair"."eligibility" <> 'eligible' or ("__new_performance_pair"."reference_score" is not null and "__new_performance_pair"."mae" is not null and "__new_performance_pair"."learning_exposure_matched" and "__new_performance_pair"."retest_interview_id" is not null and abs("__new_performance_pair"."mae" - abs("__new_performance_pair"."predicted_score" - "__new_performance_pair"."reference_score")) < 0.000000001)),
	CONSTRAINT "performance_pair_ineligible_reasons" CHECK("__new_performance_pair"."eligibility" <> 'ineligible' or json_array_length("__new_performance_pair"."ineligibility_reasons") > 0)
);
--> statement-breakpoint
INSERT INTO `__new_performance_pair`("id", "prediction_id", "user_id", "role_id", "skill_id", "retest_interview_id", "predicted_score", "reference_score", "mae", "eligibility", "ineligibility_reasons", "difficulty", "rubric_version", "learning_exposure_matched", "paired_at", "created_at") SELECT "id", "prediction_id", "user_id", "role_id", "skill_id", "retest_interview_id", "predicted_score", "reference_score", "mae", "eligibility", "ineligibility_reasons", "difficulty", "rubric_version", "learning_exposure_matched", "paired_at", "created_at" FROM `performance_pair`;--> statement-breakpoint
DROP TABLE `performance_pair`;--> statement-breakpoint
ALTER TABLE `__new_performance_pair` RENAME TO `performance_pair`;--> statement-breakpoint
CREATE UNIQUE INDEX `performance_pair_prediction_unique` ON `performance_pair` (`prediction_id`);--> statement-breakpoint
CREATE INDEX `performance_pair_role_eligibility_idx` ON `performance_pair` (`role_id`,`eligibility`);--> statement-breakpoint
CREATE TABLE `__new_audio_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`interview_id` text NOT NULL,
	`turn_id` text,
	`storage_key` text,
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
	FOREIGN KEY (`interview_id`) REFERENCES `interview_session`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`turn_id`) REFERENCES `interview_turn`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "audio_asset_status_values" CHECK("__new_audio_asset"."status" in ('uploaded', 'transcribing', 'transcribed', 'confirmed', 'failed', 'deleted')),
	CONSTRAINT "audio_asset_byte_size_positive" CHECK("__new_audio_asset"."byte_size" > 0),
	CONSTRAINT "audio_asset_duration_positive" CHECK("__new_audio_asset"."duration_ms" is null or "__new_audio_asset"."duration_ms" > 0),
	CONSTRAINT "audio_asset_retention_requires_consent" CHECK("__new_audio_asset"."retention_until" is null or "__new_audio_asset"."consent_for_review"),
	CONSTRAINT "audio_asset_deleted_at_consistency" CHECK(("__new_audio_asset"."status" = 'deleted') = ("__new_audio_asset"."deleted_at" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_audio_asset`("id", "user_id", "interview_id", "turn_id", "storage_key", "mime_type", "byte_size", "duration_ms", "status", "consent_for_review", "retention_until", "delete_requested_at", "deleted_at", "created_at", "updated_at") SELECT "id", "user_id", "interview_id", "turn_id", "storage_key", "mime_type", "byte_size", "duration_ms", "status", "consent_for_review", "retention_until", "delete_requested_at", "deleted_at", "created_at", "updated_at" FROM `audio_asset`;--> statement-breakpoint
DROP TABLE `audio_asset`;--> statement-breakpoint
ALTER TABLE `__new_audio_asset` RENAME TO `audio_asset`;--> statement-breakpoint
CREATE INDEX `audio_asset_interview_idx` ON `audio_asset` (`interview_id`);--> statement-breakpoint
CREATE INDEX `audio_asset_user_idx` ON `audio_asset` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_audio_analysis` (
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
	FOREIGN KEY (`audio_asset_id`) REFERENCES `audio_asset`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "audio_analysis_pause_ratio_range" CHECK("__new_audio_analysis"."pause_ratio" is null or "__new_audio_analysis"."pause_ratio" between 0 and 1),
	CONSTRAINT "audio_analysis_clarity_range" CHECK("__new_audio_analysis"."clarity_score" is null or "__new_audio_analysis"."clarity_score" between 0 and 1),
	CONSTRAINT "audio_analysis_emotion_confidence_range" CHECK("__new_audio_analysis"."emotion_confidence" is null or "__new_audio_analysis"."emotion_confidence" between 0 and 1),
	CONSTRAINT "audio_analysis_voiced_duration_positive" CHECK("__new_audio_analysis"."voiced_duration_ms" is null or "__new_audio_analysis"."voiced_duration_ms" > 0),
	CONSTRAINT "audio_analysis_clarity_verified_requires_score" CHECK("__new_audio_analysis"."clarity_verified" = false or "__new_audio_analysis"."clarity_score" is not null),
	CONSTRAINT "audio_analysis_emotion_verified_requires_score" CHECK("__new_audio_analysis"."emotion_verified" = false or "__new_audio_analysis"."emotion_confidence" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_audio_analysis`("id", "audio_asset_id", "voiced_duration_ms", "pause_ratio", "speech_rate_chars_per_min", "clarity_score", "clarity_verified", "emotion_label", "emotion_confidence", "emotion_verified", "provider", "model", "evidence", "created_at") SELECT "id", "audio_asset_id", "voiced_duration_ms", "pause_ratio", "speech_rate_chars_per_min", "clarity_score", "clarity_verified", "emotion_label", "emotion_confidence", "emotion_verified", "provider", "model", "evidence", "created_at" FROM `audio_analysis`;--> statement-breakpoint
DROP TABLE `audio_analysis`;--> statement-breakpoint
ALTER TABLE `__new_audio_analysis` RENAME TO `audio_analysis`;--> statement-breakpoint
CREATE UNIQUE INDEX `audio_analysis_audio_asset_unique` ON `audio_analysis` (`audio_asset_id`);--> statement-breakpoint
CREATE TABLE `__new_interview_turn` (
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
	FOREIGN KEY (`interview_id`) REFERENCES `interview_session`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "interview_turn_status_values" CHECK("__new_interview_turn"."status" in ('awaiting_answer', 'processing_answer', 'answered', 'skipped')),
	CONSTRAINT "interview_turn_question_type_values" CHECK("__new_interview_turn"."question_type" in ('technical', 'project', 'scenario', 'behavioral')),
	CONSTRAINT "interview_turn_answer_modality_values" CHECK("__new_interview_turn"."answer_modality" is null or "__new_interview_turn"."answer_modality" in ('text', 'voice')),
	CONSTRAINT "interview_turn_seq_non_negative" CHECK("__new_interview_turn"."seq" >= 0),
	CONSTRAINT "interview_turn_difficulty_range" CHECK("__new_interview_turn"."difficulty" between 1 and 5),
	CONSTRAINT "interview_turn_answer_length" CHECK("__new_interview_turn"."answer" is null or length("__new_interview_turn"."answer") between 1 and 10000),
	CONSTRAINT "interview_turn_hints_non_negative" CHECK("__new_interview_turn"."hints_used" >= 0),
	CONSTRAINT "interview_turn_answer_consistency" CHECK(("__new_interview_turn"."status" = 'answered') = ("__new_interview_turn"."answer" is not null and "__new_interview_turn"."answer_submitted_at" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_interview_turn`("id", "interview_id", "seq", "question_id", "question_text", "question_type", "skill_id", "difficulty", "status", "answer", "answer_modality", "answer_transcript_id", "idempotency_key", "hints_used", "answer_submitted_at", "created_at", "updated_at") SELECT "id", "interview_id", "seq", "question_id", "question_text", "question_type", "skill_id", "difficulty", "status", "answer", "answer_modality", "answer_transcript_id", "idempotency_key", "hints_used", "answer_submitted_at", "created_at", "updated_at" FROM `interview_turn`;--> statement-breakpoint
DROP TABLE `interview_turn`;--> statement-breakpoint
ALTER TABLE `__new_interview_turn` RENAME TO `interview_turn`;--> statement-breakpoint
CREATE UNIQUE INDEX `interview_turn_seq_unique` ON `interview_turn` (`interview_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `interview_turn_idempotency_unique` ON `interview_turn` (`interview_id`,`idempotency_key`) WHERE "interview_turn"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX `interview_turn_interview_idx` ON `interview_turn` (`interview_id`,`seq`);--> statement-breakpoint
CREATE TABLE `__new_transcript` (
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
	FOREIGN KEY (`audio_asset_id`) REFERENCES `audio_asset`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "transcript_status_values" CHECK("__new_transcript"."status" in ('pending', 'ready', 'confirmed', 'failed')),
	CONSTRAINT "transcript_confidence_range" CHECK("__new_transcript"."confidence" is null or "__new_transcript"."confidence" between 0 and 1),
	CONSTRAINT "transcript_confirmed_consistency" CHECK(("__new_transcript"."status" = 'confirmed') = ("__new_transcript"."confirmed_text" is not null and "__new_transcript"."confirmed_at" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_transcript`("id", "audio_asset_id", "raw_text", "confirmed_text", "status", "language", "confidence", "provider", "model", "created_at", "confirmed_at", "updated_at") SELECT "id", "audio_asset_id", "raw_text", "confirmed_text", "status", "language", "confidence", "provider", "model", "created_at", "confirmed_at", "updated_at" FROM `transcript`;--> statement-breakpoint
DROP TABLE `transcript`;--> statement-breakpoint
ALTER TABLE `__new_transcript` RENAME TO `transcript`;--> statement-breakpoint
CREATE INDEX `transcript_audio_asset_idx` ON `transcript` (`audio_asset_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_budget_ledger` (
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
	FOREIGN KEY (`run_id`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`attempt_id`) REFERENCES `run_attempt`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "budget_ledger_operation_values" CHECK("__new_budget_ledger"."operation" in ('reserve', 'dispatch', 'settle', 'unknown')),
	CONSTRAINT "budget_ledger_status_values" CHECK("__new_budget_ledger"."status" in ('open', 'settled', 'unknown')),
	CONSTRAINT "budget_ledger_amounts_non_negative" CHECK("__new_budget_ledger"."llm_calls" >= 0 and "__new_budget_ledger"."tool_calls" >= 0 and "__new_budget_ledger"."input_tokens" >= 0 and "__new_budget_ledger"."output_tokens" >= 0),
	CONSTRAINT "budget_ledger_settled_consistency" CHECK(("__new_budget_ledger"."status" = 'settled') = ("__new_budget_ledger"."settled_at" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_budget_ledger`("id", "run_id", "attempt_id", "operation", "status", "llm_calls", "tool_calls", "input_tokens", "output_tokens", "settled_at", "note", "created_at") SELECT "id", "run_id", "attempt_id", "operation", "status", "llm_calls", "tool_calls", "input_tokens", "output_tokens", "settled_at", "note", "created_at" FROM `budget_ledger`;--> statement-breakpoint
DROP TABLE `budget_ledger`;--> statement-breakpoint
ALTER TABLE `__new_budget_ledger` RENAME TO `budget_ledger`;--> statement-breakpoint
CREATE INDEX `budget_ledger_run_idx` ON `budget_ledger` (`run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_idempotency_record` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`route` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`interview_id` text,
	`run_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`interview_id`) REFERENCES `interview_session`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_id`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "idempotency_record_key_length" CHECK(length("__new_idempotency_record"."idempotency_key") between 1 and 128)
);
--> statement-breakpoint
INSERT INTO `__new_idempotency_record`("id", "user_id", "route", "idempotency_key", "request_hash", "interview_id", "run_id", "created_at") SELECT "id", "user_id", "route", "idempotency_key", "request_hash", "interview_id", "run_id", "created_at" FROM `idempotency_record`;--> statement-breakpoint
DROP TABLE `idempotency_record`;--> statement-breakpoint
ALTER TABLE `__new_idempotency_record` RENAME TO `idempotency_record`;--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_record_scope_unique` ON `idempotency_record` (`user_id`,`route`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `__new_plan_decision` (
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
	FOREIGN KEY (`interview_id`) REFERENCES `interview_session`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_id`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`turn_id`) REFERENCES `interview_turn`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "plan_decision_action_values" CHECK("__new_plan_decision"."action" in ('deepen', 'switch_skill', 'adjust_difficulty', 'finish')),
	CONSTRAINT "plan_decision_rationale_length" CHECK(length(trim("__new_plan_decision"."rationale")) between 1 and 500),
	CONSTRAINT "plan_decision_remaining_seconds_non_negative" CHECK("__new_plan_decision"."remaining_seconds" is null or "__new_plan_decision"."remaining_seconds" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_plan_decision`("id", "interview_id", "run_id", "turn_id", "action", "skill_id", "question_id", "rationale", "evidence_refs", "remaining_seconds", "created_at") SELECT "id", "interview_id", "run_id", "turn_id", "action", "skill_id", "question_id", "rationale", "evidence_refs", "remaining_seconds", "created_at" FROM `plan_decision`;--> statement-breakpoint
DROP TABLE `plan_decision`;--> statement-breakpoint
ALTER TABLE `__new_plan_decision` RENAME TO `plan_decision`;--> statement-breakpoint
CREATE INDEX `plan_decision_interview_idx` ON `plan_decision` (`interview_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_run_attempt` (
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
	FOREIGN KEY (`run_id`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "run_attempt_status_values" CHECK("__new_run_attempt"."status" in ('running', 'completed', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "run_attempt_no_range" CHECK("__new_run_attempt"."attempt_no" between 1 and 2),
	CONSTRAINT "run_attempt_terminal_ended_at" CHECK(("__new_run_attempt"."status" = 'running') = ("__new_run_attempt"."ended_at" is null))
);
--> statement-breakpoint
INSERT INTO `__new_run_attempt`("id", "run_id", "attempt_no", "status", "lease_until", "started_at", "ended_at", "provider", "model", "usage", "error", "terminal_reason") SELECT "id", "run_id", "attempt_no", "status", "lease_until", "started_at", "ended_at", "provider", "model", "usage", "error", "terminal_reason" FROM `run_attempt`;--> statement-breakpoint
DROP TABLE `run_attempt`;--> statement-breakpoint
ALTER TABLE `__new_run_attempt` RENAME TO `run_attempt`;--> statement-breakpoint
CREATE UNIQUE INDEX `run_attempt_no_unique` ON `run_attempt` (`run_id`,`attempt_no`);--> statement-breakpoint
CREATE INDEX `run_attempt_run_idx` ON `run_attempt` (`run_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `__new_evaluation` (
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
	FOREIGN KEY (`interview_id`) REFERENCES `interview_session`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`turn_id`) REFERENCES `interview_turn`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "evaluation_scoring_status_values" CHECK("__new_evaluation"."scoring_status" in ('scored', 'partial', 'skipped')),
	CONSTRAINT "evaluation_overall_range" CHECK("__new_evaluation"."overall_score" is null or "__new_evaluation"."overall_score" between 0 and 1),
	CONSTRAINT "evaluation_confidence_range" CHECK("__new_evaluation"."confidence" between 0 and 1)
);
--> statement-breakpoint
INSERT INTO `__new_evaluation`("id", "interview_id", "turn_id", "user_id", "role_id", "skill_id", "question_id", "rubric_id", "rubric_version", "evaluator_version", "scoring_status", "overall_score", "confidence", "missing_dimensions", "strengths", "gaps", "evidence", "answer_digest", "answer_version", "created_at") SELECT "id", "interview_id", "turn_id", "user_id", "role_id", "skill_id", "question_id", "rubric_id", "rubric_version", "evaluator_version", "scoring_status", "overall_score", "confidence", "missing_dimensions", "strengths", "gaps", "evidence", "answer_digest", "answer_version", "created_at" FROM `evaluation`;--> statement-breakpoint
DROP TABLE `evaluation`;--> statement-breakpoint
ALTER TABLE `__new_evaluation` RENAME TO `evaluation`;--> statement-breakpoint
CREATE UNIQUE INDEX `evaluation_turn_unique` ON `evaluation` (`turn_id`);--> statement-breakpoint
CREATE INDEX `evaluation_interview_idx` ON `evaluation` (`interview_id`);--> statement-breakpoint
CREATE INDEX `evaluation_skill_idx` ON `evaluation` (`user_id`,`role_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `__new_report_dimension` (
	`report_id` text NOT NULL,
	`dimension` text NOT NULL,
	`score` real,
	`evidence_refs` text DEFAULT '[]' NOT NULL,
	`note` text,
	PRIMARY KEY(`report_id`, `dimension`),
	FOREIGN KEY (`report_id`) REFERENCES `interview_report`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "report_dimension_values" CHECK("__new_report_dimension"."dimension" in ('correctness', 'depth', 'logic', 'role_fit', 'communication', 'speech_acoustics', 'speech_emotion')),
	CONSTRAINT "report_dimension_score_range" CHECK("__new_report_dimension"."score" is null or "__new_report_dimension"."score" between 0 and 1)
);
--> statement-breakpoint
INSERT INTO `__new_report_dimension`("report_id", "dimension", "score", "evidence_refs", "note") SELECT "report_id", "dimension", "score", "evidence_refs", "note" FROM `report_dimension`;--> statement-breakpoint
DROP TABLE `report_dimension`;--> statement-breakpoint
ALTER TABLE `__new_report_dimension` RENAME TO `report_dimension`;--> statement-breakpoint
CREATE TABLE `__new_interview_report` (
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
	FOREIGN KEY (`interview_id`) REFERENCES `interview_session`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "interview_report_overall_range" CHECK("__new_interview_report"."overall_score" is null or "__new_interview_report"."overall_score" between 0 and 1)
);
--> statement-breakpoint
INSERT INTO `__new_interview_report`("id", "interview_id", "user_id", "role_id", "policy_version", "rubric_version", "overall_score", "summary", "strengths", "gaps", "practice_advice", "missing_dimensions", "generated_at", "created_at") SELECT "id", "interview_id", "user_id", "role_id", "policy_version", "rubric_version", "overall_score", "summary", "strengths", "gaps", "practice_advice", "missing_dimensions", "generated_at", "created_at" FROM `interview_report`;--> statement-breakpoint
DROP TABLE `interview_report`;--> statement-breakpoint
ALTER TABLE `__new_interview_report` RENAME TO `interview_report`;--> statement-breakpoint
CREATE UNIQUE INDEX `interview_report_interview_unique` ON `interview_report` (`interview_id`);--> statement-breakpoint
CREATE INDEX `interview_report_user_idx` ON `interview_report` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_recommendation` (
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
	FOREIGN KEY (`interview_id`) REFERENCES `interview_session`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`report_id`) REFERENCES `interview_report`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "recommendation_action_values" CHECK("__new_recommendation"."action" in ('practice', 'review_resource', 'retest')),
	CONSTRAINT "recommendation_status_values" CHECK("__new_recommendation"."status" in ('suggested', 'accepted', 'completed', 'dismissed')),
	CONSTRAINT "recommendation_rationale_not_blank" CHECK(length(trim("__new_recommendation"."rationale")) > 0),
	CONSTRAINT "recommendation_resource_requirement" CHECK("__new_recommendation"."action" <> 'review_resource' or "__new_recommendation"."resource_id" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_recommendation`("id", "user_id", "role_id", "skill_id", "interview_id", "report_id", "resource_id", "action", "rationale", "status", "created_at", "updated_at") SELECT "id", "user_id", "role_id", "skill_id", "interview_id", "report_id", "resource_id", "action", "rationale", "status", "created_at", "updated_at" FROM `recommendation`;--> statement-breakpoint
DROP TABLE `recommendation`;--> statement-breakpoint
ALTER TABLE `__new_recommendation` RENAME TO `recommendation`;--> statement-breakpoint
CREATE INDEX `recommendation_user_skill_idx` ON `recommendation` (`user_id`,`role_id`,`skill_id`);--> statement-breakpoint
CREATE TABLE `__new_prediction_snapshot` (
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
	FOREIGN KEY (`source_interview_id`) REFERENCES `interview_session`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "prediction_snapshot_status_values" CHECK("__new_prediction_snapshot"."status" in ('pending', 'paired', 'expired')),
	CONSTRAINT "prediction_snapshot_score_range" CHECK("__new_prediction_snapshot"."predicted_target_score" between 0 and 1),
	CONSTRAINT "prediction_snapshot_window" CHECK("__new_prediction_snapshot"."valid_until" > "__new_prediction_snapshot"."predicted_at"),
	CONSTRAINT "prediction_snapshot_exposure_not_blank" CHECK(length(trim("__new_prediction_snapshot"."expected_learning_exposure")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_prediction_snapshot`("id", "user_id", "role_id", "skill_id", "source_interview_id", "predicted_at", "expected_learning_exposure", "valid_until", "rubric_version", "predicted_target_score", "predictor_version", "evidence_refs", "status", "created_at") SELECT "id", "user_id", "role_id", "skill_id", "source_interview_id", "predicted_at", "expected_learning_exposure", "valid_until", "rubric_version", "predicted_target_score", "predictor_version", "evidence_refs", "status", "created_at" FROM `prediction_snapshot`;--> statement-breakpoint
DROP TABLE `prediction_snapshot`;--> statement-breakpoint
ALTER TABLE `__new_prediction_snapshot` RENAME TO `prediction_snapshot`;--> statement-breakpoint
CREATE INDEX `prediction_snapshot_skill_idx` ON `prediction_snapshot` (`user_id`,`role_id`,`skill_id`,`valid_until`);--> statement-breakpoint
CREATE INDEX `prediction_snapshot_status_idx` ON `prediction_snapshot` (`status`);--> statement-breakpoint
CREATE TABLE `__new_reflection` (
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
	FOREIGN KEY (`interview_id`) REFERENCES `interview_session`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "reflection_status_values" CHECK("__new_reflection"."status" in ('pending', 'completed', 'failed')),
	CONSTRAINT "reflection_skill_coverage_range" CHECK("__new_reflection"."skill_coverage" is null or "__new_reflection"."skill_coverage" between 0 and 1),
	CONSTRAINT "reflection_repeat_rate_range" CHECK("__new_reflection"."repeat_rate" is null or "__new_reflection"."repeat_rate" between 0 and 1),
	CONSTRAINT "reflection_plan_adherence_range" CHECK("__new_reflection"."plan_adherence" is null or "__new_reflection"."plan_adherence" between 0 and 1),
	CONSTRAINT "reflection_longest_run_non_negative" CHECK("__new_reflection"."longest_skill_run" is null or "__new_reflection"."longest_skill_run" >= 0),
	CONSTRAINT "reflection_completed_consistency" CHECK(("__new_reflection"."status" = 'completed') = ("__new_reflection"."completed_at" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_reflection`("id", "interview_id", "user_id", "role_id", "status", "skill_coverage", "repeat_rate", "plan_adherence", "longest_skill_run", "objectives", "new_evidence_count", "duplicate_question_ids", "missed_skill_ids", "uncertainty", "timing", "summary", "candidate_policy_version", "created_at", "completed_at") SELECT "id", "interview_id", "user_id", "role_id", "status", "skill_coverage", "repeat_rate", "plan_adherence", "longest_skill_run", "objectives", "new_evidence_count", "duplicate_question_ids", "missed_skill_ids", "uncertainty", "timing", "summary", "candidate_policy_version", "created_at", "completed_at" FROM `reflection`;--> statement-breakpoint
DROP TABLE `reflection`;--> statement-breakpoint
ALTER TABLE `__new_reflection` RENAME TO `reflection`;--> statement-breakpoint
CREATE UNIQUE INDEX `reflection_interview_unique` ON `reflection` (`interview_id`);--> statement-breakpoint
CREATE INDEX `reflection_user_idx` ON `reflection` (`user_id`,`created_at`);