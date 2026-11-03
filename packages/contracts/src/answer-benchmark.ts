import { z } from 'zod';
import { EvaluationOutputSchema } from './evaluation.ts';
import { RoleIdSchema, ErrorCodeSchema } from './tools.ts';
const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const AnswerSplitSchema = z.enum(['development', 'validation', 'reserved-final']);
export const AnswerCaseSchema = z.object({ id, version: id, questionId: id, groupId: id, split: AnswerSplitSchema,
  variant: z.enum(['complete', 'misconception', 'insufficient']), answer: z.string().trim().min(1).max(4000),
}).strict();
export const AnswerReferenceSchema = z.object({ caseId: id, version: id, caseDigest: digest, rubricDigest: digest,
  origin: z.literal('synthetic-proposed'), reviewStatus: z.literal('draft'), rationale: z.string().min(1).max(2000),
  assessment: EvaluationOutputSchema.pick({ evidence: true, criterionScores: true }),
}).strict();
export const AnswerBundleSchema = z.object({ manifest: z.object({ id, version: id, authoredAt: z.iso.date(),
  origin: z.literal('assistant-authored-synthetic'), knowledgePins: z.array(z.object({ questionId: id, contentDigest: digest, sourcesDigest: digest }).strict()).min(1).max(100),
}).strict(), cases: z.array(AnswerCaseSchema).min(1).max(200), references: z.array(AnswerReferenceSchema).min(1).max(200) }).strict();
const rowIdentity = { caseId: id, roleId: RoleIdSchema, questionId: id, rubricVersion: id };
export const AnswerRowSchema = z.discriminatedUnion('status', [
  z.object({ ...rowIdentity, status: z.literal('completed'), scores: z.array(z.object({ criterionId: id, score: z.number().nonnegative().max(100).nullable() }).strict()).min(1).max(20), assessmentDigest: digest }).strict(),
  z.object({ ...rowIdentity, status: z.enum(['failed', 'cancelled', 'timed_out']), error: ErrorCodeSchema }).strict(),
]);
const errorMetric = z.object({ sumAbsoluteError: z.number().nonnegative(), sumSignedError: z.number(), pairedCount: z.number().int().nonnegative(),
  mae: z.number().min(0).max(1).nullable(), bias: z.number().min(-1).max(1).nullable() }).strict();
export const AnswerAnalysisSchema = z.object({ comparison: z.literal('draft-reference-descriptive'), humanReferenceCount: z.literal(0), qualityClaimEligible: z.literal(false),
  roles: z.array(z.object({ roleId: RoleIdSchema, totalCount: z.number().int().nonnegative(), completedCount: z.number().int().nonnegative(), failureCount: z.number().int().nonnegative(),
    fullyScoredCount: z.number().int().nonnegative(), criterionError: errorMetric, weightedError: errorMetric,
    dimensions: z.array(z.object({ dimension: z.string().min(1), error: errorMetric }).strict()).max(20),
    nullAgreement: z.object({ pairedScored: z.number().int().nonnegative(), overScored: z.number().int().nonnegative(), underScored: z.number().int().nonnegative(), bothMissing: z.number().int().nonnegative() }).strict(),
    humanReferenceMae: z.null(),
  }).strict()).length(2),
}).strict();
export const AnswerReportSchema = z.object({ version: z.literal(1), datasetId: id, datasetVersion: id, datasetDigest: digest,
  split: z.enum(['development', 'validation']), evaluatorId: id, evaluatorMode: z.literal('offline-fixture'),
  startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(), productionPublished: z.literal(false),
  rows: z.array(AnswerRowSchema).max(200), analysis: AnswerAnalysisSchema, digest,
}).strict();
export type AnswerBundle = z.infer<typeof AnswerBundleSchema>;
export type AnswerRow = z.infer<typeof AnswerRowSchema>;
export type AnswerReport = z.infer<typeof AnswerReportSchema>;
export type AnswerAnalysis = z.infer<typeof AnswerAnalysisSchema>;
