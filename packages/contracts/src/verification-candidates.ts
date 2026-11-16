import {z} from 'zod';
export const VerificationExtractionSchema=z.enum(['verbatim-quotes','candidate-refs']);
const candidate=z.object({id:z.string().regex(/^vc-[a-f0-9]{24}$/),excerpt:z.string().min(1).max(500),context:z.object({before:z.string().max(24),after:z.string().max(24)}).strict()}).strict();
const list=z.array(candidate).max(16);
export const VerificationCandidateCatalogSchema=z.array(z.object({criterionId:z.string().min(1).max(100),action:list,target:list,expectation:list,metric:list.optional(),value:list.optional(),condition:list.optional()}).strict()).max(20);
export type VerificationCandidateCatalog=z.infer<typeof VerificationCandidateCatalogSchema>;
