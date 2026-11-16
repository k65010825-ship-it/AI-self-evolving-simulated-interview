import {z} from 'zod';
import {ScoringStabilityPolicySchema} from './scoring-quality.ts';
const digest=z.string().regex(/^[a-f0-9]{64}$/),count=z.number().int().nonnegative(),score=z.number().min(0).max(1);
const outcome=z.enum(['scored','needs_clarification','abstained','failed','not_run']);
export const ScoringStabilityComparisonSchema=z.object({version:z.literal(1),mode:z.enum(['live-http','injected-http']),
 batchDigests:z.tuple([digest,digest]),reportDigests:z.tuple([digest,digest]),policy:ScoringStabilityPolicySchema,
 total:z.literal(8),outcomeConsistent:count.max(8),expectedDimensionPairs:count.max(160),pairedDimensions:count.max(160),missingDimensionPairs:count.max(160),
 bothDraftChecksPassed:z.boolean(),meanAbsoluteDrift:score.nullable(),maxAbsoluteDrift:score.nullable(),draftStabilityPassed:z.boolean(),
 outcomes:z.array(z.object({caseId:z.string(),left:outcome,right:outcome,consistent:z.boolean()}).strict()).length(8),
 dimensions:z.array(z.object({caseId:z.string(),criterionId:z.string(),left:score,right:score,absoluteDrift:score}).strict()).max(160),
 humanReferenceCount:z.literal(0),qualityClaimEligible:z.literal(false),digest}).strict();
export type ScoringStabilityComparison=z.infer<typeof ScoringStabilityComparisonSchema>;
