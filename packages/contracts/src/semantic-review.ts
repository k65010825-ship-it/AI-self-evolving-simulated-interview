import { z } from 'zod';
import { SupportLabelSchema } from './semantic-evaluation.ts';
import { RoleIdSchema } from './tools.ts';
const id=z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),hash=z.string().regex(/^[a-f0-9]{64}$/),time=z.number().int().nonnegative();
export const SemanticReviewErrorCodeSchema=z.enum(['SEMANTIC_REVIEW_INVALID','SEMANTIC_REVIEW_CONFLICT','SEMANTIC_REVIEW_STALE',
 'SEMANTIC_REVIEW_SELF_REVIEW','SEMANTIC_REVIEW_CHECKS_FAILED','SEMANTIC_REVIEW_NO_CHANGE']);
export const ReviewReferenceSchema=z.object({verdict:SupportLabelSchema,rationale:z.string().trim().min(1).max(2000)}).strict();
export const SemanticReviewActionSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('revise_label'),reference:ReviewReferenceSchema,changeReason:z.string().trim().min(1).max(2000)}).strict(),
 z.object({kind:z.literal('review_label'),decision:z.enum(['approved','changes_requested']),checks:z.object({literalMatch:z.boolean(),criterionAlignment:z.boolean(),scoreSupport:z.boolean()}).strict(),
  note:z.string().trim().min(1).max(2000)}).strict(),
]);
export const SemanticReviewOperationSchema=z.object({operationId:id,expectedLedgerVersion:time,claimId:id,expectedLabelVersion:time,
 requestDigest:hash,labelDigest:hash,occurredAt:time,action:SemanticReviewActionSchema}).strict();
export const SemanticReviewHostSchema=z.object({actorId:id,now:time}).strict();
export const SemanticReviewLedgerSchema=z.object({schemaVersion:z.literal(1),kind:z.literal('uncommitted-semantic-review-ledger'),datasetId:id,datasetDigest:hash,
 authority:z.literal('file-declared-unverified'),createdAt:time,updatedAt:time,version:time,
 baseline:z.array(z.object({claimId:id,roleId:RoleIdSchema,sourceCaseId:id,groupId:id,requestDigest:hash,reference:ReviewReferenceSchema,
  referenceDigest:hash,authorId:z.literal('assistant-proposed')}).strict()).min(1).max(200),
 records:z.array(z.object({seq:z.number().int().positive(),actorId:id,authority:z.literal('file-declared-unverified'),acceptedAt:time,
  operation:SemanticReviewOperationSchema}).strict()).max(2000),digest:hash}).strict();
export type SemanticReviewLedger=z.infer<typeof SemanticReviewLedgerSchema>;
export type SemanticReviewOperation=z.infer<typeof SemanticReviewOperationSchema>;
