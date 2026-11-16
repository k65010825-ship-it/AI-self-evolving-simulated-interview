import { z } from 'zod';
import { RoleIdSchema,KnowledgeItemSchema } from './tools.ts';
import { RubricSchema } from './scoring.ts';
import {VerificationCandidateCatalogSchema} from './verification-candidates.ts';
/** Explicit empty collections retain the context shape without allowing history or optional knowledge. */
export const ScoringPayloadSchema=z.object({roleId:RoleIdSchema,phase:z.literal('scoring'),
 answer:z.object({text:z.string().min(1).max(10000),truncated:z.literal(false)}).strict(),
 memory:z.array(z.unknown()).length(0),knowledge:z.array(z.unknown()).length(0)}).strict();
export const ScoringModelInputSchema=z.object({outputSchemaVersion:z.literal(1),interview:ScoringPayloadSchema,
 question:z.object({text:z.string().min(1).max(4000),skillId:z.string().trim().min(1).max(100),questionType:KnowledgeItemSchema.shape.questionType,
  difficulty:KnowledgeItemSchema.shape.difficulty}).strict(),rubric:RubricSchema,verificationCandidates:VerificationCandidateCatalogSchema.optional()}).strict()
 .superRefine((r,ctx)=>{if(r.rubric.roleId!==r.interview.roleId)ctx.addIssue({code:'custom',message:'Scoring role mismatch.'});});
