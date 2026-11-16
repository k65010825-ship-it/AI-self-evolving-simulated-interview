import {VerificationBindingSchema} from './verification-binding.ts';
import { z } from 'zod';
import { RoleIdSchema, ToolContextSchema, ErrorCodeSchema } from './tools.ts';
import { ContentScopeSchema,CriterionMetadata,validAnchors } from './rubric-dimensions.ts';
const id = z.string().min(1).max(100);
export const RubricSchema = z.object({ id, version: id, roleId: RoleIdSchema,
  scope: ContentScopeSchema, criteria: z.array(z.object({ id,
    maxScore: z.number().positive().max(100), weight: z.number().positive().max(1), required: z.boolean(),
    description: z.string().min(1).max(1000).optional(),
    ...CriterionMetadata,
  }).strict().refine(c=>(!c.verificationGoal||c.dimension==='verification')&&validAnchors(c.maxScore,c.anchors),'Anchors must be ordered from zero to maxScore.')).min(1).max(20) }).strict().superRefine((v, ctx) => {
  if (new Set(v.criteria.map(c => c.id)).size !== v.criteria.length
    || Math.abs(v.criteria.reduce((s, c) => s + c.weight, 0) - 1) > 1e-9)
    ctx.addIssue({ code: 'custom', message: 'Unique criteria and weights summing to one required.' });
});
export const ScoringInputSchema = z.object({ rubricId: id, rubricVersion: id,
  criterionScores: z.array(z.object({ verificationBinding:VerificationBindingSchema.optional(),criterionId: id, score: z.number().nonnegative().nullable(),
    evidenceIds: z.array(id).max(30) }).strict()).max(20),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.criterionScores.map(c => c.criterionId)).size !== v.criterionScores.length
    || v.criterionScores.some(c => new Set(c.evidenceIds).size !== c.evidenceIds.length))
    ctx.addIssue({ code: 'custom', message: 'Duplicate criterion or evidence.' });
});
export const ScoringContextSchema = ToolContextSchema.extend({ answerId: id, answerText: z.string().max(10000),
  evidence: z.array(z.object({ id, start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
    excerpt: z.string().min(1).max(10000) }).strict()).max(100),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.evidence.map(e => e.id)).size !== v.evidence.length || v.evidence.some(e =>
    e.end <= e.start || e.end > v.answerText.length || v.answerText.slice(e.start, e.end) !== e.excerpt))
    ctx.addIssue({ code: 'custom', message: 'Evidence must match answer UTF-16 offsets.' });
});
export const ScoringResultSchema = z.object({ answerId: id, rubricId: id, rubricVersion: id,
  scope: ContentScopeSchema, normalizedScore: z.number().min(0).max(1).nullable(),
  coverageWeight: z.number().min(0).max(1), complete: z.boolean(), missingDimensions: z.array(id),
  dimensions: z.array(z.object({ verificationBinding:VerificationBindingSchema.optional(),criterionId: id, score: z.number().nonnegative().nullable(),
    normalizedScore: z.number().min(0).max(1).nullable(), evidenceIds: z.array(id) }).strict()),
}).strict();
export const ScoringReceiptSchema = z.object({ callId: z.string(), toolName: z.literal('compute_rubric_score'),
  status: z.enum(['ok', 'insufficient_evidence', 'error']), durationMs: z.number().nonnegative(),
  data: ScoringResultSchema.optional(), error: z.object({ code: ErrorCodeSchema, message: z.string(), retryable: z.boolean() }).strict().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.status === 'error' ? (!v.error || !!v.data) : (!v.data || !!v.error))
    ctx.addIssue({ code: 'custom', message: 'Receipt status must agree with data/error.' });
  if (v.data && ((v.status === 'insufficient_evidence') !== (v.data.normalizedScore === null)))
    ctx.addIssue({ code: 'custom', message: 'Insufficient evidence requires null score.' });
});
export type ScoringReceipt = z.infer<typeof ScoringReceiptSchema>;
