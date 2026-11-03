import { z } from 'zod';
import { InterviewStateSchema } from './interview-state.ts';
import { RoleIdSchema,KnowledgeItemSchema } from './tools.ts';
import { TurnInputSchema, TurnProposalSchema, EvaluationOutputSchema } from './evaluation.ts';
import { RubricSchema, ScoringResultSchema, ScoringContextSchema } from './scoring.ts';
import { ResourceRecommendationSchema, ResourceReceiptSchema } from './resources.ts';
import { SpeechExpressionSchema, SpeechTranscriptSchema } from './speech.ts';
const id = z.string().min(1).max(100);
export const EvidenceModeSchema = z.enum(['offline-fixture', 'live-model', 'unverified', 'mixed']);
export const ReportTurnSchema = z.object({ input: TurnInputSchema, proposal: TurnProposalSchema,
  evidenceMode: z.enum(['offline-fixture', 'live-model', 'unverified']) }).strict();
export const ReportInputSchema = z.object({ state: InterviewStateSchema, generatedAt: z.number().int().nonnegative(),
  policyVersion: id, skillLabels: z.record(id, z.string().trim().min(1).max(80)), turns: z.array(ReportTurnSchema).max(200) }).strict();
export const ReportExpressionSchema=z.discriminatedUnion('status',[
  z.object({status:z.literal('not_evaluated'),reason:z.enum(['audio_and_expression_evaluation_not_integrated','no_confirmed_audio']),
    speechRate:z.null(),clarity:z.null(),confidence:z.null()}).strict(),
  z.object({status:z.literal('audio_descriptions'),scope:z.literal('audio-timing-only'),
    speechEvidenceMode:z.enum(['offline-fixture','live-asr','mixed']),
    coverage:z.object({totalAnswers:z.number().int().nonnegative(),speechAnswers:z.number().int().positive(),
      textAnswers:z.number().int().nonnegative(),descriptiveAnswers:z.number().int().nonnegative(),insufficientAnswers:z.number().int().nonnegative()}).strict(),
    answers:z.array(z.object({answerId:id,questionId:id,transcriptionId:id,
      audio:SpeechTranscriptSchema.shape.audio,mode:SpeechTranscriptSchema.shape.mode,provider:SpeechTranscriptSchema.shape.provider,
      confirmedAt:z.number().int().nonnegative(),originalText:z.string().max(10000),confirmedText:z.string().min(1).max(10000),
      features:SpeechExpressionSchema,warnings:z.array(z.string())}).strict()).min(1).max(200),
    speechRate:z.null(),clarity:z.null(),confidence:z.null(),emotion:z.null(),
  }).strict(),
]);
export const ContentReportSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('uncommitted-content-report'),
  sessionId: id, sessionVersion: z.number().int().nonnegative(), roleId: RoleIdSchema, generatedAt: z.number().int().nonnegative(),
  policyVersion: id, evidenceMode: EvidenceModeSchema, scope: z.enum(['technical-content','behavioral-content','mixed-content']),
  coverage: z.object({ totalSkills: z.number().int().nonnegative(), observedSkills: z.number().int().nonnegative(),
    totalAnswers: z.number().int().nonnegative(), independentQuestions: z.number().int().nonnegative() }).strict(),
  skills: z.array(z.object({ skillId: id, label: z.string(), mastery: z.number().min(0).max(1).nullable(),
    confidence: z.number().min(0).max(1), independentQuestions: z.number().int().nonnegative(),
    rubricVersions: z.array(z.object({ id, version: id }).strict()) }).strict()),
  assessments: z.array(z.object({ observationId: id, answerId: id, questionId: id, skillId: id,
    questionType:KnowledgeItemSchema.shape.questionType.optional(),
    questionText: z.string(), difficulty: z.number().int().min(1).max(5), rubricId: id, rubricVersion: id,
    rubric: RubricSchema, evaluation: ScoringResultSchema, evidence: ScoringContextSchema.shape.evidence,
    feedback: EvaluationOutputSchema.shape.feedback, evidenceMode: EvidenceModeSchema }).strict()),
  expression: ReportExpressionSchema,
  studyPlan: z.array(z.object({ skillId: id, label: z.string(), reason: z.enum(['assess_unknown', 'repair_gap', 'verify_uncertainty']),
    minutes: z.number().int().positive(), actions: z.array(z.string()).min(1), evidenceAnswerIds: z.array(id),
    retest: z.object({ requireDifferentQuestion: z.literal(true), excludeQuestionIds: z.array(id),
      successCriteria: z.string().min(1) }).strict() }).strict()).max(3),
  resourceRecommendations: z.array(ResourceRecommendationSchema).max(6), warnings: z.array(z.string()),
}).strict();
export type ContentReport = z.infer<typeof ContentReportSchema>;
export const ResourceEnrichmentSchema = z.object({ report: ContentReportSchema, queries: z.array(ResourceReceiptSchema).max(3) }).strict();
export type ResourceEnrichment = z.infer<typeof ResourceEnrichmentSchema>;
