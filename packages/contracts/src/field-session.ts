import {z} from 'zod';import {KnowledgeItemSchema,RoleIdSchema} from './tools.ts';
const id=z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/);
export const FieldParticipantSchema=z.object({participantId:id,consentRecordId:id,consentedAt:z.number().int().positive(),developmentReviewerIds:z.array(id).max(100)}).strict();
export const FieldSessionManifestSchema=FieldParticipantSchema.extend({version:z.literal(1),studyId:id,createdAt:z.number().int().positive(),
 origin:z.literal('participant-declared-not-authenticated'),knowledgeStatus:z.literal('draft'),items:z.array(KnowledgeItemSchema).length(16),
 sourceReferences:z.record(z.string(),z.array(z.object({sourceId:z.string(),sourceVersion:z.string(),locator:z.string()}).strict()))}).strict();
export const FieldAnswerCommandSchema=z.object({roleId:RoleIdSchema,questionId:id,text:z.string().trim().min(2).max(10000)}).strict();
export type FieldParticipant=z.infer<typeof FieldParticipantSchema>;
