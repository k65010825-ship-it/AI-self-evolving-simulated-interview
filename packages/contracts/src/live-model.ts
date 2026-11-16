import { z } from 'zod';
import { LiveModelProfileSchema } from './model-access.ts';
import {OutputRepairPolicySchema,EvidenceGroundingPolicySchema}from'./evaluation-diagnostic.ts';
import{QuestionDeliveryModeSchema}from'./question-delivery.ts';
import{ModelRecoveryPolicySchema}from'./model-recovery.ts';
import {VerificationExtractionSchema} from './verification-candidates.ts';
export const LiveServiceConfigSchema=z.object({profile:LiveModelProfileSchema,
 authorization:z.object({enabled:z.boolean().default(false),operatorApproved:z.boolean().default(false),expiresAt:z.number().int().nonnegative(),maxRuns:z.number().int().min(1).max(32)}).strict(),
 planning:z.enum(['deterministic','pi-knowledge']).default('deterministic'),outputRepair:OutputRepairPolicySchema.default('none'),
 evaluationResponseFormat:z.enum(['text','json_object']).optional(),
 verificationExtraction:VerificationExtractionSchema.optional(),
 evidenceGrounding:EvidenceGroundingPolicySchema.default('model-offsets'),questionDelivery:QuestionDeliveryModeSchema.default('canonical'),
 recovery:ModelRecoveryPolicySchema.prefault({})}).strict().refine(c=>(c.recovery.initialOutputTokens??c.profile.limits.maxOutputTokens)<=c.profile.limits.maxOutputTokens,'Initial output exceeds hard limit')
 .refine(c=>!(c.evaluationResponseFormat==='json_object'&&c.recovery.maxOutputRecoveries>0&&c.recovery.truncationMode==='continue'),'JSON object output cannot use fragment continuation')
 .refine(c=>c.verificationExtraction!=='candidate-refs'||c.evidenceGrounding==='quoted-spans','Candidate extraction requires quoted spans');
export type LiveServiceConfig=z.infer<typeof LiveServiceConfigSchema>;
