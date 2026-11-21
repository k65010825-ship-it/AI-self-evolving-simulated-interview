CREATE TYPE "public"."account_role" AS ENUM('student', 'admin');--> statement-breakpoint
CREATE TYPE "public"."adoption_status" AS ENUM('not_adopted', 'adopted');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."content_release_status" AS ENUM('draft', 'published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."dataset_group" AS ENUM('development', 'internal_validation', 'final_acceptance', 'scenario_branch');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('not_published', 'published', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."eval_case_source" AS ENUM('synthetic', 'consented');--> statement-breakpoint
CREATE TYPE "public"."eval_dataset_status" AS ENUM('draft', 'frozen', 'retired');--> statement-breakpoint
CREATE TYPE "public"."eval_label_source" AS ENUM('expert', 'model', 'unlabeled');--> statement-breakpoint
CREATE TYPE "public"."experiment_execution_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."experiment_status" AS ENUM('created', 'running', 'evaluated', 'passed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."feedback_category" AS ENUM('question_quality', 'report_accuracy', 'audio_quality', 'agent_behavior', 'other');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('open', 'triaged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."knowledge_review_decision" AS ENUM('approve', 'reject', 'deprecate');--> statement-breakpoint
CREATE TYPE "public"."knowledge_review_target" AS ENUM('knowledge_item', 'rubric');--> statement-breakpoint
CREATE TYPE "public"."learning_resource_availability" AS ENUM('available', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."learning_resource_level" AS ENUM('intro', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."metric_evidence_kind" AS ENUM('real', 'synthetic', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."metric_scope" AS ENUM('system', 'role');--> statement-breakpoint
CREATE TYPE "public"."policy_status" AS ENUM('baseline', 'candidate', 'champion', 'retired', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('not_published', 'published');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('technical', 'project', 'scenario', 'behavioral');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('draft', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."source_verification_status" AS ENUM('draft', 'pending', 'content-checked');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
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
	"account_role" "account_role" DEFAULT 'student' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"password_hash" text NOT NULL,
	"password_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_length" CHECK (char_length("app_user"."email") between 3 and 320),
	CONSTRAINT "app_user_display_name_length" CHECK (char_length("app_user"."display_name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "job_role" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"knowledge_version" text NOT NULL,
	"rubric_version" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_role_name_length" CHECK (char_length("job_role"."name") between 1 and 80)
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
	"content_hash" text,
	"review_status" "review_status" DEFAULT 'draft' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_item_difficulty_range" CHECK ("knowledge_item"."difficulty" between 1 and 5),
	CONSTRAINT "knowledge_item_question_not_blank" CHECK (char_length(btrim("knowledge_item"."question")) > 0),
	CONSTRAINT "knowledge_item_key_points_not_empty" CHECK (jsonb_array_length("knowledge_item"."key_points") > 0),
	CONSTRAINT "knowledge_item_reviewed_has_hash" CHECK ("knowledge_item"."review_status" <> 'reviewed' or ("knowledge_item"."content_hash" is not null and "knowledge_item"."reviewed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "knowledge_review" (
	"id" text PRIMARY KEY NOT NULL,
	"target_type" "knowledge_review_target" NOT NULL,
	"target_id" text NOT NULL,
	"version" text NOT NULL,
	"content_hash" text NOT NULL,
	"decision" "knowledge_review_decision" NOT NULL,
	"from_status" "review_status" NOT NULL,
	"to_status" "review_status" NOT NULL,
	"reviewer_id" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_review_target_id_length" CHECK (char_length("knowledge_review"."target_id") between 1 and 80),
	CONSTRAINT "knowledge_review_version_length" CHECK (char_length("knowledge_review"."version") between 1 and 40),
	CONSTRAINT "knowledge_review_hash_length" CHECK (char_length("knowledge_review"."content_hash") between 1 and 128),
	CONSTRAINT "knowledge_review_status_change" CHECK (("knowledge_review"."decision" = 'approve' and "knowledge_review"."to_status" = 'reviewed') or ("knowledge_review"."decision" = 'reject' and "knowledge_review"."to_status" = "knowledge_review"."from_status") or ("knowledge_review"."decision" = 'deprecate' and "knowledge_review"."to_status" = 'draft'))
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
CREATE TABLE "rubric_criterion" (
	"rubric_id" text NOT NULL,
	"criterion_id" text NOT NULL,
	"dimension" text,
	"description" text NOT NULL,
	"max_score" numeric(5, 2) NOT NULL,
	"weight" numeric(5, 4) NOT NULL,
	"anchors" jsonb,
	"evidence_rule" jsonb,
	"verification_goal" text,
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
	"content_hash" text,
	"review_status" "review_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rubric_version_length" CHECK (char_length("rubric"."version") between 1 and 40),
	CONSTRAINT "rubric_reviewed_has_hash" CHECK ("rubric"."review_status" <> 'reviewed' or "rubric"."content_hash" is not null)
);
--> statement-breakpoint
CREATE TABLE "policy_version" (
	"version" text PRIMARY KEY NOT NULL,
	"role_id" text,
	"skill_id" text,
	"status" "policy_status" DEFAULT 'candidate' NOT NULL,
	"publication_status" "publication_status" DEFAULT 'not_published' NOT NULL,
	"adoption_status" "adoption_status" DEFAULT 'not_adopted' NOT NULL,
	"parent_version" text,
	"parameters" jsonb NOT NULL,
	"change_reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"adopted_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	CONSTRAINT "policy_version_max_followup_depth" CHECK (("policy_version"."parameters" ->> 'maxFollowupDepth')::int between 1 and 5),
	CONSTRAINT "policy_version_uncertainty_boost" CHECK (("policy_version"."parameters" ->> 'uncertaintyPriorityBoost')::numeric between 0 and 1),
	CONSTRAINT "policy_version_coverage_reserve" CHECK (("policy_version"."parameters" ->> 'coverageReserveRatio')::numeric between 0 and 1),
	CONSTRAINT "policy_version_published_at" CHECK (("policy_version"."publication_status" = 'published') = ("policy_version"."published_at" is not null)),
	CONSTRAINT "policy_version_adopted_at" CHECK (("policy_version"."adoption_status" = 'adopted') = ("policy_version"."adopted_at" is not null))
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
CREATE TABLE "eval_case" (
	"id" text PRIMARY KEY NOT NULL,
	"dataset_id" text NOT NULL,
	"role_id" text NOT NULL,
	"skill_id" text,
	"source" "eval_case_source" DEFAULT 'synthetic' NOT NULL,
	"source_group" text,
	"label_source" "eval_label_source" DEFAULT 'unlabeled' NOT NULL,
	"review_status" "review_status" DEFAULT 'draft' NOT NULL,
	"authorization_ref" text,
	"input" jsonb NOT NULL,
	"expected" jsonb NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_case_consented_requires_authorization" CHECK ("eval_case"."source" <> 'consented' or "eval_case"."authorization_ref" is not null),
	CONSTRAINT "eval_case_reviewed_has_hash" CHECK ("eval_case"."review_status" <> 'reviewed' or "eval_case"."content_hash" is not null)
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
	"content_hash" text,
	"frozen_at" timestamp with time zone,
	"frozen_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_dataset_item_count_non_negative" CHECK ("eval_dataset"."item_count" >= 0),
	CONSTRAINT "eval_dataset_frozen_consistency" CHECK (("eval_dataset"."status" = 'frozen') = ("eval_dataset"."frozen_at" is not null)),
	CONSTRAINT "eval_dataset_frozen_has_hash" CHECK ("eval_dataset"."status" <> 'frozen' or "eval_dataset"."content_hash" is not null)
);
--> statement-breakpoint
CREATE TABLE "eval_experiment" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"baseline_policy_version" text NOT NULL,
	"candidate_policy_version" text NOT NULL,
	"dataset_id" text NOT NULL,
	"dataset_version" text NOT NULL,
	"dataset_digest" text NOT NULL,
	"config_digest" text NOT NULL,
	"execution_budget" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"authorized_by" text,
	"authorized_at" timestamp with time zone,
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
	CONSTRAINT "eval_experiment_running_requires_authorization" CHECK ("eval_experiment"."status" <> 'running' or ("eval_experiment"."authorized_by" is not null and "eval_experiment"."authorized_at" is not null)),
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
CREATE TABLE "experiment_execution" (
	"id" text PRIMARY KEY NOT NULL,
	"experiment_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" "experiment_execution_status" DEFAULT 'queued' NOT NULL,
	"budget" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"authorized_by" text,
	"authorized_at" timestamp with time zone,
	"usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiment_execution_terminal_consistency" CHECK (("experiment_execution"."status" in ('completed', 'failed', 'cancelled')) = ("experiment_execution"."ended_at" is not null))
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
	"actor_role" "account_role",
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
CREATE TABLE "metric_measure" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"name" text NOT NULL,
	"numerator" numeric(18, 4) NOT NULL,
	"denominator" numeric(18, 4) NOT NULL,
	"value" numeric(9, 4),
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"evidence_kind" "metric_evidence_kind" DEFAULT 'mixed' NOT NULL,
	"applicable_version" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_measure_denominator_positive" CHECK ("metric_measure"."denominator" > 0),
	CONSTRAINT "metric_measure_numerator_non_negative" CHECK ("metric_measure"."numerator" >= 0),
	CONSTRAINT "metric_measure_window_order" CHECK ("metric_measure"."window_end" > "metric_measure"."window_start"),
	CONSTRAINT "metric_measure_value_range" CHECK ("metric_measure"."value" is null or "metric_measure"."value" between 0 and 1),
	CONSTRAINT "metric_measure_source_not_blank" CHECK (char_length(btrim("metric_measure"."source")) > 0)
);
--> statement-breakpoint
CREATE TABLE "metric_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" "metric_scope" NOT NULL,
	"role_id" text,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"evidence_kind" "metric_evidence_kind" DEFAULT 'mixed' NOT NULL,
	"data_source" text NOT NULL,
	"applicable_version" text,
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
	CONSTRAINT "metric_snapshot_data_source_not_blank" CHECK (char_length(btrim("metric_snapshot"."data_source")) > 0),
	CONSTRAINT "metric_snapshot_ratio_ranges" CHECK (("metric_snapshot"."run_failure_rate" is null or "metric_snapshot"."run_failure_rate" between 0 and 1) and ("metric_snapshot"."skill_coverage" is null or "metric_snapshot"."skill_coverage" between 0 and 1) and ("metric_snapshot"."repeat_rate" is null or "metric_snapshot"."repeat_rate" between 0 and 1) and ("metric_snapshot"."plan_adherence" is null or "metric_snapshot"."plan_adherence" between 0 and 1)),
	CONSTRAINT "metric_snapshot_counts_non_negative" CHECK ("metric_snapshot"."interview_count" >= 0 and "metric_snapshot"."completed_interview_count" >= 0 and "metric_snapshot"."sample_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "content_release" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"content_hash" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"resource_location" text,
	"status" "content_release_status" DEFAULT 'draft' NOT NULL,
	"created_by" text,
	"published_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_release_version_length" CHECK (char_length("content_release"."version") between 1 and 40),
	CONSTRAINT "content_release_hash_length" CHECK (char_length("content_release"."content_hash") between 1 and 128),
	CONSTRAINT "content_release_published_at" CHECK (("content_release"."status" = 'published') = ("content_release"."published_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_source" ADD CONSTRAINT "knowledge_item_source_knowledge_item_id_knowledge_item_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_source" ADD CONSTRAINT "knowledge_item_source_source_id_knowledge_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item" ADD CONSTRAINT "knowledge_item_rubric_id_rubric_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubric"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item" ADD CONSTRAINT "knowledge_item_reviewed_by_app_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item" ADD CONSTRAINT "knowledge_item_role_skill_fk" FOREIGN KEY ("role_id","skill_id") REFERENCES "public"."role_skill"("role_id","skill_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_review" ADD CONSTRAINT "knowledge_review_reviewer_id_app_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_skill" ADD CONSTRAINT "role_skill_role_id_job_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."job_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criterion" ADD CONSTRAINT "rubric_criterion_rubric_id_rubric_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubric"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric" ADD CONSTRAINT "rubric_role_skill_fk" FOREIGN KEY ("role_id","skill_id") REFERENCES "public"."role_skill"("role_id","skill_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_version" ADD CONSTRAINT "policy_version_role_id_job_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."job_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_version" ADD CONSTRAINT "policy_version_parent_version_policy_version_version_fk" FOREIGN KEY ("parent_version") REFERENCES "public"."policy_version"("version") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_version" ADD CONSTRAINT "policy_version_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_resource_skill" ADD CONSTRAINT "learning_resource_skill_resource_id_learning_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."learning_resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_resource_skill" ADD CONSTRAINT "learning_resource_skill_role_fk" FOREIGN KEY ("role_id","skill_id") REFERENCES "public"."role_skill"("role_id","skill_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_resource" ADD CONSTRAINT "learning_resource_role_id_job_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."job_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_case" ADD CONSTRAINT "eval_case_dataset_id_eval_dataset_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."eval_dataset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_case" ADD CONSTRAINT "eval_case_role_id_job_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."job_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_dataset" ADD CONSTRAINT "eval_dataset_role_id_job_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."job_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_dataset" ADD CONSTRAINT "eval_dataset_frozen_by_app_user_id_fk" FOREIGN KEY ("frozen_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_experiment" ADD CONSTRAINT "eval_experiment_role_id_job_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."job_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_experiment" ADD CONSTRAINT "eval_experiment_dataset_id_eval_dataset_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."eval_dataset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_experiment" ADD CONSTRAINT "eval_experiment_authorized_by_app_user_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_experiment" ADD CONSTRAINT "eval_experiment_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_experiment" ADD CONSTRAINT "eval_experiment_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_experiment" ADD CONSTRAINT "eval_experiment_baseline_policy_fk" FOREIGN KEY ("baseline_policy_version") REFERENCES "public"."policy_version"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_experiment" ADD CONSTRAINT "eval_experiment_candidate_policy_fk" FOREIGN KEY ("candidate_policy_version") REFERENCES "public"."policy_version"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_case_result" ADD CONSTRAINT "experiment_case_result_experiment_id_eval_experiment_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."eval_experiment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_case_result" ADD CONSTRAINT "experiment_case_result_case_id_eval_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eval_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_execution" ADD CONSTRAINT "experiment_execution_experiment_id_eval_experiment_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."eval_experiment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_execution" ADD CONSTRAINT "experiment_execution_authorized_by_app_user_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_champion" ADD CONSTRAINT "policy_champion_role_id_job_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."job_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_champion" ADD CONSTRAINT "policy_champion_policy_version_policy_version_version_fk" FOREIGN KEY ("policy_version") REFERENCES "public"."policy_version"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_champion" ADD CONSTRAINT "policy_champion_previous_policy_fk" FOREIGN KEY ("previous_policy_version") REFERENCES "public"."policy_version"("version") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_champion" ADD CONSTRAINT "policy_champion_experiment_fk" FOREIGN KEY ("activated_by_experiment_id") REFERENCES "public"."eval_experiment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert" ADD CONSTRAINT "alert_experiment_id_eval_experiment_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."eval_experiment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_entry" ADD CONSTRAINT "feedback_entry_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_measure" ADD CONSTRAINT "metric_measure_snapshot_id_metric_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."metric_snapshot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshot" ADD CONSTRAINT "metric_snapshot_role_id_job_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."job_role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_release" ADD CONSTRAINT "content_release_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_session_token_hash_unique" ON "auth_session" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_family_idx" ON "auth_session" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_unique" ON "app_user" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "app_user_account_role_idx" ON "app_user" USING btree ("account_role");--> statement-breakpoint
CREATE INDEX "knowledge_item_source_source_idx" ON "knowledge_item_source" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "knowledge_item_scope_idx" ON "knowledge_item" USING btree ("role_id","skill_id","review_status");--> statement-breakpoint
CREATE INDEX "knowledge_item_scope_version_idx" ON "knowledge_item" USING btree ("role_id","skill_id","version");--> statement-breakpoint
CREATE INDEX "knowledge_item_role_type_idx" ON "knowledge_item" USING btree ("role_id","question_type");--> statement-breakpoint
CREATE INDEX "knowledge_review_target_idx" ON "knowledge_review" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_scope_version_unique" ON "rubric" USING btree ("role_id","skill_id","version");--> statement-breakpoint
CREATE INDEX "rubric_role_idx" ON "rubric" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "policy_version_status_idx" ON "policy_version" USING btree ("status");--> statement-breakpoint
CREATE INDEX "policy_version_role_idx" ON "policy_version" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "policy_version_publication_idx" ON "policy_version" USING btree ("publication_status");--> statement-breakpoint
CREATE INDEX "learning_resource_skill_scope_idx" ON "learning_resource_skill" USING btree ("role_id","skill_id");--> statement-breakpoint
CREATE INDEX "learning_resource_role_idx" ON "learning_resource" USING btree ("role_id","review_status");--> statement-breakpoint
CREATE INDEX "eval_case_dataset_idx" ON "eval_case" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "eval_case_skill_idx" ON "eval_case" USING btree ("role_id","skill_id");--> statement-breakpoint
CREATE INDEX "eval_case_source_group_idx" ON "eval_case" USING btree ("source_group");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_dataset_scope_unique" ON "eval_dataset" USING btree ("role_id","name","version");--> statement-breakpoint
CREATE INDEX "eval_dataset_group_idx" ON "eval_dataset" USING btree ("role_id","group");--> statement-breakpoint
CREATE INDEX "eval_experiment_role_idx" ON "eval_experiment" USING btree ("role_id","created_at");--> statement-breakpoint
CREATE INDEX "eval_experiment_status_idx" ON "eval_experiment" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_case_result_unique" ON "experiment_case_result" USING btree ("experiment_id","case_id");--> statement-breakpoint
CREATE INDEX "experiment_execution_experiment_idx" ON "experiment_execution" USING btree ("experiment_id","created_at");--> statement-breakpoint
CREATE INDEX "experiment_execution_status_idx" ON "experiment_execution" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_champion_scope_unique" ON "policy_champion" USING btree ("role_id",coalesce("skill_id", '')) WHERE "policy_champion"."rolled_back_at" is null;--> statement-breakpoint
CREATE INDEX "policy_champion_role_idx" ON "policy_champion" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "alert_status_idx" ON "alert" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "alert_severity_idx" ON "alert" USING btree ("severity","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "feedback_entry_status_idx" ON "feedback_entry" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_measure_name_unique" ON "metric_measure" USING btree ("snapshot_id","name");--> statement-breakpoint
CREATE INDEX "metric_measure_snapshot_idx" ON "metric_measure" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "metric_snapshot_window_idx" ON "metric_snapshot" USING btree ("scope","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "content_release_version_unique" ON "content_release" USING btree ("version");--> statement-breakpoint
CREATE INDEX "content_release_status_idx" ON "content_release" USING btree ("status","published_at");