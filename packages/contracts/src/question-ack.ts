import { z } from 'zod';
import { MemoryIdentitySchema } from './memory.ts';
const id=z.string().min(1).max(100),time=z.number().int().nonnegative(),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const QuestionPresentationPacketSchema=z.object({deliveryId:id,sessionId:id,questionId:id,roleId:MemoryIdentitySchema.shape.roleId,
 text:z.string().min(1).max(4200),textDigest:digest,issuedAt:time,expiresAt:time}).strict().refine(p=>p.expiresAt>p.issuedAt,'Invalid presentation time');
export const QuestionAckCommandSchema=z.object({deliveryId:id,sessionId:id,questionId:id,textDigest:digest,commandId:id,clientInstanceId:id}).strict();
export const QuestionAckReceiptSchema=QuestionAckCommandSchema.extend({receivedAt:time,confirmationSource:z.literal('client-reported')}).strict();
export const QuestionPresentationRecordSchema=z.object({schemaVersion:z.literal(1),identity:MemoryIdentitySchema,packet:QuestionPresentationPacketSchema,
 workflowDigest:digest,contentDigest:digest,planRunId:id,planAttemptId:id,originStorageVersion:z.number().int().nonnegative(),
 createdAt:time,version:z.union([z.literal(0),z.literal(1)]),acknowledgement:QuestionAckReceiptSchema.nullable()}).strict().superRefine((r,ctx)=>{
 const p=r.packet,a=r.acknowledgement;
 if(r.identity.roleId!==p.roleId||r.createdAt<p.issuedAt||r.createdAt>=p.expiresAt||(r.version===0)!==(a===null)||
  a&&(a.deliveryId!==p.deliveryId||a.sessionId!==p.sessionId||a.questionId!==p.questionId||a.textDigest!==p.textDigest||a.receivedAt<r.createdAt||a.receivedAt>=p.expiresAt))ctx.addIssue({code:'custom',message:'Presentation record binding mismatch.'});
});
export const QuestionAckPlanSchema=z.object({kind:z.literal('uncommitted-question-ack-plan'),committed:z.literal(false),
 where:z.object({deliveryId:id,recordVersion:z.literal(0),recordDigest:digest,storageVersion:z.number().int().nonnegative(),workflowDigest:digest}).strict(),
 next:QuestionPresentationRecordSchema,receipt:QuestionAckReceiptSchema}).strict();
export const QuestionAckReplaySchema=z.object({kind:z.literal('question-ack-replay'),committed:z.literal(false),receipt:QuestionAckReceiptSchema}).strict();
export const QuestionAckDecisionSchema=z.discriminatedUnion('kind',[QuestionAckPlanSchema,QuestionAckReplaySchema]);
export const QuestionAckErrorCodeSchema=z.enum(['PRESENTATION_VALIDATION_ERROR','PRESENTATION_BINDING_INVALID','PRESENTATION_FORBIDDEN',
 'PRESENTATION_EXPIRED','PRESENTATION_CLOCK_INVALID','PRESENTATION_OPERATION_CONFLICT','PRESENTATION_STALE','PRESENTATION_NOT_ACKNOWLEDGED']);
export type QuestionPresentationRecord=z.infer<typeof QuestionPresentationRecordSchema>;
export type QuestionAckDecision=z.infer<typeof QuestionAckDecisionSchema>;
export type QuestionAckErrorCode=z.infer<typeof QuestionAckErrorCodeSchema>;
