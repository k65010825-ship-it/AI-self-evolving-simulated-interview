import{z}from'zod';
import{AgentRunRequestSchema,AgentRunSnapshotSchema}from'./agent-run.ts';
import{ModelBudgetSnapshotSchema,ModelUsageSchema}from'./model-access.ts';
export const DurableTaskSchema=z.object({request:AgentRunRequestSchema,requestDigest:z.string().regex(/^[a-f0-9]{64}$/),
 status:z.enum(['queued','running','completed','failed','cancelled','interrupted']),ownerId:z.string().min(1).max(100),fence:z.number().int().nonnegative(),
 leaseUntil:z.number().int().nonnegative(),snapshot:AgentRunSnapshotSchema.nullable()}).strict();
export const BudgetReconciliationSchema=z.object({runId:z.string().min(1).max(100),attemptId:z.string().min(1).max(100),
 identity:z.object({userId:z.string().min(1).max(100),roleId:z.enum(['java-backend','web-frontend'])}).strict(),
 callId:z.string().min(1).max(100),expectedVersion:z.number().int().nonnegative(),usage:ModelUsageSchema,
 evidenceRef:z.string().min(1).max(200)}).strict();
export const BudgetReconciliationReceiptSchema=z.object({runId:z.string(),callId:z.string(),usage:ModelUsageSchema,evidenceRef:z.string(),
 fromVersion:z.number().int().nonnegative(),toVersion:z.number().int().nonnegative(),reconciledAt:z.number().int().nonnegative(),
 authority:z.literal('host-supplied-usage-not-vendor-verified')}).strict();
export const DurableAccountingSchema=z.object({runId:z.string(),snapshot:ModelBudgetSnapshotSchema}).strict();
