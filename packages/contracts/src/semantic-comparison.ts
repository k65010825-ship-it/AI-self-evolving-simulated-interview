import { z } from 'zod';
import { SemanticMetricSchema,SupportLabelSchema } from './semantic-evaluation.ts';
import { RoleIdSchema } from './tools.ts';
const hash=z.string().regex(/^[a-f0-9]{64}$/),count=z.number().int().nonnegative();
export const SemanticComparisonSchema=z.object({version:z.literal(1),kind:z.literal('semantic-candidate-shadow-comparison'),
 datasetDigest:hash,predictionReportDigest:hash,ledgerDigest:hash,ledgerVersion:count,
 authority:z.literal('file-declared-unverified'),selection:z.literal('revised-and-declared-approved-only'),
 adoptedCount:count,unchangedCount:count,baseline:SemanticMetricSchema,candidate:SemanticMetricSchema,
 roles:z.array(z.object({roleId:RoleIdSchema,baseline:SemanticMetricSchema,candidate:SemanticMetricSchema}).strict()).length(2),
 claims:z.array(z.object({claimId:z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),labelVersion:count,labelDigest:hash,
 baselineVerdict:SupportLabelSchema,candidateVerdict:SupportLabelSchema,
 disposition:z.enum(['adopted','baseline_unrevised','baseline_unreviewed','baseline_changes_requested','baseline_disputed'])}).strict()).min(1).max(200),
 humanReferenceCount:z.literal(0),qualityClaimEligible:z.literal(false),baselineOverwritten:z.literal(false),inferenceReexecuted:z.literal(false),
 digest:hash}).strict();
export type SemanticComparison=z.infer<typeof SemanticComparisonSchema>;
