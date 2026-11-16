import {z} from 'zod';
const id=z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/);
const count=z.number().int().nonnegative().max(1_000_000_000);
const money=z.number().int().nonnegative().max(1_000_000_000_000);
export const SessionAccountingPolicySchema=z.object({sessionId:id,userId:id,roleId:id,currency:z.enum(['CNY','USD']),
 maxCostMicros:money,maxCalls:count.min(1),maxConcurrent:count.min(1),deadlineAt:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict();
export const SessionPricingProvenanceSchema=z.object({source:z.string().min(1).max(500),version:z.string().min(1).max(100),
 unit:z.enum(['token','audio-ms','character','request'])}).strict();
export const SessionReservationSchema=z.object({sessionId:id,userId:id,roleId:id,operationId:id,attemptId:id,
 kind:z.enum(['llm','asr','tts']),reservedCostMicros:money.min(1),pricing:SessionPricingProvenanceSchema}).strict();
export const SessionCostEvidenceSchema=z.object({kind:z.enum(['host-usage','host-imported-bill']),reference:z.string().min(1).max(500),
 sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const SessionReconciliationSchema=z.object({sessionId:id,attemptId:id,expectedVersion:count,reconciliationId:id,
 actualCostMicros:money,evidence:SessionCostEvidenceSchema}).strict();
export const SessionAccountingEntrySchema=SessionReservationSchema.extend({status:z.enum(['reserved','dispatched','unknown','responded','released','settled']),
 admittedAt:z.number().int().nonnegative(),actualCostMicros:money.optional(),evidence:SessionCostEvidenceSchema.optional()});
export const SessionAccountingSnapshotSchema=z.object({schemaVersion:z.literal(1),policy:SessionAccountingPolicySchema,version:count,locked:z.boolean(),
 authority:z.literal('host-supplied-not-vendor-verified'),entries:z.array(SessionAccountingEntrySchema),
 totals:z.object({callsConsumed:count,activeSlots:count,heldCostMicros:money,usedCostMicros:money}).strict()}).strict();
export const SessionReconciliationReceiptSchema=SessionReconciliationSchema.extend({fromVersion:count,toVersion:count,reconciledAt:z.number().int().nonnegative(),
 authority:z.literal('host-supplied-not-vendor-verified')});
export type SessionAccountingPolicy=z.infer<typeof SessionAccountingPolicySchema>;
export type SessionReservation=z.infer<typeof SessionReservationSchema>;
export type SessionAccountingEntry=z.infer<typeof SessionAccountingEntrySchema>;
export type SessionAccountingSnapshot=z.infer<typeof SessionAccountingSnapshotSchema>;
export type SessionReconciliation=z.infer<typeof SessionReconciliationSchema>;
