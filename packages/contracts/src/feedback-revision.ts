import {z} from 'zod';
import {EvaluationOutputSchema} from './evaluation.ts';
import {RoleIdSchema} from './tools.ts';
const id=z.string().trim().min(1).max(100),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const FeedbackRevisionCommandSchema=z.object({requestId:id,expectedVersion:z.number().int().min(0).max(20),expectedHeadDigest:digest,
 feedback:EvaluationOutputSchema.shape.feedback,note:z.string().trim().min(1).max(1000)}).strict();
export const FeedbackRevisionRecordSchema=z.object({kind:z.literal('uncommitted-feedback-revision'),policyVersion:z.literal('feedback-revision-v1'),authority:z.literal('host-declared-unverified'),
 version:z.number().int().min(1).max(20),requestId:id,originSourceDigest:digest,parentSourceDigest:digest,revisionDigest:digest,sourceDigest:digest,publicationDigest:digest,
 feedback:EvaluationOutputSchema.shape.feedback,editorId:id,createdAt:z.number().int().nonnegative(),note:FeedbackRevisionCommandSchema.shape.note,digest}).strict();
export const FeedbackRevisionHistorySchema=z.object({kind:z.literal('uncommitted-feedback-revision-history'),version:z.literal(1),policyVersion:z.literal('feedback-revision-v1'),
 userId:id,roleId:RoleIdSchema,sessionId:id,originSourceDigest:digest,headSourceDigest:digest,records:z.array(FeedbackRevisionRecordSchema).max(20),
 qualityClaimEligible:z.literal(false),identityVerified:z.literal(false),digest}).strict();
export type FeedbackRevisionHistory=z.infer<typeof FeedbackRevisionHistorySchema>;
