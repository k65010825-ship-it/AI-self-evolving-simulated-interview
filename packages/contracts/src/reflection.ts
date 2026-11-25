import{z}from'zod';
import{PlanningPolicyVersionSchema,PlanningPolicySchema}from'./policy.ts';
import{ReportInputSchema,EvidenceModeSchema}from'./report.ts';
import{RoleIdSchema}from'./tools.ts';
import{InterviewStateSchema}from'./interview-state.ts';
import{NextActionSchema}from'./evaluation.ts';
import {ExecutedQuestionPlanSchema,QuestionIssueEvidenceSchema} from './question-selection.ts';
import {KnowledgeCatalogPinSchema} from './knowledge-catalog.ts';
const id=z.string().min(1).max(100);
export const RatioSchema=z.object({numerator:z.number().int().nonnegative(),denominator:z.number().int().nonnegative(),
 value:z.number().min(0).max(1).nullable()}).strict();
export const PolicyCandidateSchema=z.object({id,baselineId:z.string().min(1).max(80),roleId:RoleIdSchema,
 sourceSessionId:id,sourceGroupId:id,createdAt:z.number().int().nonnegative(),evidenceMode:EvidenceModeSchema,
 parameters:PlanningPolicySchema,changes:z.array(z.object({parameter:z.literal('maxFollowupDepth'),from:z.number().int().min(0).max(5),
 to:z.number().int().min(1).max(5),reason:z.literal('coverage_gap_after_long_skill_run')}).strict()).length(1)}).strict();
export const ReflectionInputSchema=z.object({reportInput:ReportInputSchema,baselinePolicy:PlanningPolicyVersionSchema,
 generatedAt:z.number().int().nonnegative(),sourceGroupId:id,catalogPin:KnowledgeCatalogPinSchema.optional(),executedPlans:z.array(ExecutedQuestionPlanSchema).max(200).optional(),
 issuedQuestions:z.array(QuestionIssueEvidenceSchema).max(200).optional(),allowDraftKnowledge:z.boolean().optional()}).strict();
export const ReflectionSchema=z.object({kind:z.literal('uncommitted-session-reflection'),sessionId:id,roleId:RoleIdSchema,
 generatedAt:z.number().int().nonnegative(),sourceGroupId:id,evidenceMode:EvidenceModeSchema,baselinePolicy:PlanningPolicyVersionSchema,
 metrics:z.object({skillCoverage:RatioSchema,repeatRate:RatioSchema,planAdherence:RatioSchema,longestSkillRun:z.number().int().nonnegative()}).strict(),
 findings:z.array(z.object({code:z.enum(['coverage_gap','repeated_question','plan_mismatch','insufficient_evidence','assisted_evidence']),observationIds:z.array(id)}).strict()),
 calibration:z.object({status:z.literal('awaiting_eligible_retest'),mae:z.null(),sampleCount:z.literal(0)}).strict(),
 candidate:PolicyCandidateSchema.nullable(),planning:z.object({version:z.literal('catalog-unseen-v1'),fallbackCount:z.number().int().nonnegative(),issuedCount:z.number().int().nonnegative()}).strict().optional()}).strict();
const LabelSchema=z.object({action:NextActionSchema.shape.action,skillId:id.nullable()}).strict();
export const PolicyValidationSuiteSchema=z.object({version:id,split:z.literal('validation'),evidenceMode:z.literal('synthetic'),
 roleId:RoleIdSchema,cases:z.array(z.object({id,groupId:id,tag:z.enum(['depth_boundary','wrap_up','turn_budget','general']),
 state:InterviewStateSchema,now:z.number().int().nonnegative(),expected:LabelSchema}).strict()).min(1).max(200)}).strict();
export const PolicyEvaluationInputSchema=z.object({baseline:PlanningPolicyVersionSchema,candidate:PolicyCandidateSchema,
 suite:PolicyValidationSuiteSchema,developmentGroupIds:z.array(id).max(100),developmentSessionIds:z.array(id).max(100).default([])}).strict();
const metric=z.object({matched:z.number().int().nonnegative(),total:z.number().int().positive(),value:z.number().min(0).max(1),
 constraintViolations:z.number().int().nonnegative()}).strict();
export const PolicyEvaluationSchema=z.object({kind:z.literal('offline-policy-evaluation'),suiteVersion:id,evidenceMode:z.literal('synthetic'),
 roleId:RoleIdSchema,baselineId:z.string(),candidateId:id,status:z.enum(['eligible_for_offline_experiment','rejected']),
 deploymentStatus:z.literal('not_published'),groups:z.number().int().nonnegative(),baseline:metric,candidate:metric,
 delta:z.number().min(-1).max(1),regressions:z.number().int().nonnegative(),reasons:z.array(z.string()),
 cases:z.array(z.object({id,groupId:id,expected:LabelSchema,baseline:NextActionSchema,candidate:NextActionSchema,
 baselineMatched:z.boolean(),candidateMatched:z.boolean()}).strict())}).strict();
export type SessionReflection=z.infer<typeof ReflectionSchema>;
export type PolicyEvaluation=z.infer<typeof PolicyEvaluationSchema>;
