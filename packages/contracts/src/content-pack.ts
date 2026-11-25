import {z} from 'zod';

export const CONTENT_PACK_RUNTIME_VERSION='local-runtime-v1' as const;

export const ContentPackFileEntrySchema=z.object({
 relativePath:z.string().min(1),
 sha256:z.string().regex(/^[a-f0-9]{64}$/),
 byteLength:z.number().int().nonnegative(),
}).strict();

export const ContentPackReviewSummarySchema=z.object({
 total:z.number().int().nonnegative(),
 readyForHumanReview:z.number().int().nonnegative(),
 reviewed:z.number().int().nonnegative(),
 returned:z.number().int().nonnegative(),
}).strict();

export const ContentPackManifestSchema=z.object({
 schemaVersion:z.literal(1),
 packId:z.string().min(1),
 packVersion:z.string().min(1),
 createdAt:z.number().int().positive(),
 compatibleRuntimeVersions:z.array(z.string().min(1)).min(1),
 authority:z.enum(['draft-preview','central-reviewed']),
 productionPublished:z.boolean(),
 reviewSummary:ContentPackReviewSummarySchema,
 files:z.array(ContentPackFileEntrySchema).min(1),
}).strict();

export const ContentPackFailureCodeSchema=z.enum([
 'MANIFEST_INVALID',
 'MISSING_FILE',
 'PATH_UNSAFE',
 'DIGEST_MISMATCH',
 'RUNTIME_INCOMPATIBLE',
 'WORKSPACE_INVALID',
 'CURATION_INVALID',
 'ROLE_CATALOG_INVALID',
 'REVIEW_SUMMARY_MISMATCH',
 'PRODUCTION_UNREVIEWED',
]);

export const ContentPackVerificationResultSchema=z.object({
 valid:z.boolean(),
 packId:z.string().nullable(),
 packVersion:z.string().nullable(),
 authority:z.enum(['draft-preview','central-reviewed']).nullable(),
 productionPublished:z.boolean(),
 retainedFallback:z.boolean(),
 failureCode:ContentPackFailureCodeSchema.nullable(),
 reasons:z.array(z.string()),
 verifiedFiles:z.number().int().nonnegative(),
 summary:ContentPackReviewSummarySchema.nullable(),
}).strict();

export type ContentPackFileEntry=z.infer<typeof ContentPackFileEntrySchema>;
export type ContentPackReviewSummary=z.infer<typeof ContentPackReviewSummarySchema>;
export type ContentPackManifest=z.infer<typeof ContentPackManifestSchema>;
export type ContentPackFailureCode=z.infer<typeof ContentPackFailureCodeSchema>;
export type ContentPackVerificationResult=z.infer<typeof ContentPackVerificationResultSchema>;
