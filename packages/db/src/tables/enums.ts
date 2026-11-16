import { pgEnum } from 'drizzle-orm/pg-core';

export const accountRole = pgEnum('account_role', ['student', 'admin']);
export const userStatus = pgEnum('user_status', ['active', 'disabled']);

export const questionType = pgEnum('question_type', ['technical', 'project', 'scenario', 'behavioral']);
export const reviewStatus = pgEnum('review_status', ['draft', 'reviewed']);
export const sourceVerificationStatus = pgEnum('source_verification_status', ['draft', 'pending', 'content-checked']);
export const knowledgeReviewDecision = pgEnum('knowledge_review_decision', ['approve', 'reject', 'deprecate']);
export const knowledgeReviewTarget = pgEnum('knowledge_review_target', ['knowledge_item', 'rubric']);

export const policyStatus = pgEnum('policy_status', ['baseline', 'candidate', 'champion', 'retired', 'rejected']);
export const publicationStatus = pgEnum('publication_status', ['not_published', 'published']);
export const adoptionStatus = pgEnum('adoption_status', ['not_adopted', 'adopted']);

export const experimentStatus = pgEnum('experiment_status', [
  'created',
  'running',
  'evaluated',
  'passed',
  'failed',
  'cancelled',
]);
export const deploymentStatus = pgEnum('deployment_status', ['not_published', 'published', 'rolled_back']);
export const experimentExecutionStatus = pgEnum('experiment_execution_status', [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const datasetGroup = pgEnum('dataset_group', [
  'development',
  'internal_validation',
  'final_acceptance',
  'scenario_branch',
]);
export const evalDatasetStatus = pgEnum('eval_dataset_status', ['draft', 'frozen', 'retired']);
export const evalCaseSource = pgEnum('eval_case_source', ['synthetic', 'consented']);
export const evalLabelSource = pgEnum('eval_label_source', ['expert', 'model', 'unlabeled']);

export const contentReleaseStatus = pgEnum('content_release_status', ['draft', 'published', 'retired']);

export const learningResourceLevel = pgEnum('learning_resource_level', ['intro', 'intermediate', 'advanced']);
export const learningResourceAvailability = pgEnum('learning_resource_availability', ['available', 'unavailable']);

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
export const metricEvidenceKind = pgEnum('metric_evidence_kind', ['real', 'synthetic', 'mixed']);