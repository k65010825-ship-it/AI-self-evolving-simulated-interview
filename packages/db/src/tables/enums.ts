import { pgEnum } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['student', 'admin']);
export const userStatus = pgEnum('user_status', ['active', 'disabled']);

export const interviewStatus = pgEnum('interview_status', [
  'planning',
  'awaiting_answer',
  'processing_answer',
  'completed',
  'cancelled',
  'failed',
]);
export const interviewKind = pgEnum('interview_kind', ['practice', 'retest']);

export const runStatus = pgEnum('run_status', ['queued', 'running', 'completed', 'failed', 'cancelled']);
export const runKind = pgEnum('run_kind', [
  'initial_plan',
  'answer_processing',
  'finish',
  'reflection',
  'experiment_evaluation',
  'learning_recommendation',
]);
export const runAttemptStatus = pgEnum('run_attempt_status', ['running', 'completed', 'failed', 'cancelled', 'expired']);
export const runEventType = pgEnum('run_event_type', [
  'run.accepted',
  'run.stage',
  'question.delta',
  'question.completed',
  'run.completed',
  'run.failed',
  'run.cancelled',
]);

export const questionType = pgEnum('question_type', ['technical', 'project', 'scenario', 'behavioral']);
export const reviewStatus = pgEnum('review_status', ['draft', 'reviewed']);
export const sourceVerificationStatus = pgEnum('source_verification_status', ['draft', 'pending', 'content-checked']);
export const knowledgeReviewDecision = pgEnum('knowledge_review_decision', ['approve', 'reject', 'deprecate']);

export const turnStatus = pgEnum('interview_turn_status', [
  'awaiting_answer',
  'processing_answer',
  'answered',
  'skipped',
]);
export const answerModality = pgEnum('answer_modality', ['text', 'voice']);
export const audioAssetStatus = pgEnum('audio_asset_status', [
  'uploaded',
  'transcribing',
  'transcribed',
  'confirmed',
  'failed',
  'deleted',
]);
export const transcriptStatus = pgEnum('transcript_status', ['pending', 'ready', 'confirmed', 'failed']);

export const evaluationDimension = pgEnum('evaluation_dimension_key', [
  'correctness',
  'depth',
  'logic',
  'role_fit',
  'communication',
  'speech_acoustics',
  'speech_emotion',
]);
export const planAction = pgEnum('plan_action', ['deepen', 'switch_skill', 'adjust_difficulty', 'finish']);

export const evidenceSource = pgEnum('evidence_source', ['interview', 'retest', 'diagnostic']);
export const learningProgressStatus = pgEnum('learning_progress_status', [
  'started',
  'self_reported',
  'verified',
  'abandoned',
]);
export const evidenceLevel = pgEnum('evidence_level', ['self_reported', 'verifiable']);
export const learningResourceLevel = pgEnum('learning_resource_level', ['intro', 'intermediate', 'advanced']);
export const learningResourceAvailability = pgEnum('learning_resource_availability', ['available', 'unavailable']);
export const recommendationAction = pgEnum('recommendation_action', ['practice', 'review_resource', 'retest']);
export const recommendationStatus = pgEnum('recommendation_status', [
  'suggested',
  'accepted',
  'completed',
  'dismissed',
]);

export const predictionStatus = pgEnum('prediction_status', ['pending', 'paired', 'expired']);
export const pairEligibility = pgEnum('pair_eligibility', ['pending', 'eligible', 'ineligible']);
export const reflectionStatus = pgEnum('reflection_status', ['pending', 'completed', 'failed']);

export const policyStatus = pgEnum('policy_status', ['baseline', 'candidate', 'champion', 'retired', 'rejected']);
export const experimentStatus = pgEnum('experiment_status', [
  'created',
  'running',
  'evaluated',
  'passed',
  'failed',
  'cancelled',
]);
export const deploymentStatus = pgEnum('deployment_status', ['not_published', 'published', 'rolled_back']);
export const datasetGroup = pgEnum('dataset_group', [
  'development',
  'internal_validation',
  'final_acceptance',
  'scenario_branch',
]);
export const evalDatasetStatus = pgEnum('eval_dataset_status', ['draft', 'frozen', 'retired']);
export const evalCaseSource = pgEnum('eval_case_source', ['synthetic', 'consented']);

export const feedbackCategory = pgEnum('feedback_category', [
  'question_quality',
  'report_accuracy',
  'audio_quality',
  'agent_behavior',
  'other',
]);
export const feedbackStatus = pgEnum('feedback_status', ['open', 'triaged', 'resolved']);
export const alertSeverity = pgEnum('alert_severity', ['info', 'warning', 'critical']);
export const alertStatus = pgEnum('alert_status', ['open', 'acknowledged', 'resolved']);
export const metricScope = pgEnum('metric_scope', ['system', 'role']);
export const xpReason = pgEnum('xp_reason', [
  'interview_completed',
  'learning_completed',
  'retest_completed',
  'hint_used',
  'admin_adjustment',
]);
