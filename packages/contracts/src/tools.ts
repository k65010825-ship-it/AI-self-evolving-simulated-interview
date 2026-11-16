import { z } from 'zod';
import { CriterionMetadata,validAnchors } from './rubric-dimensions.ts';
export const RoleIdSchema = z.enum(['java-backend', 'web-frontend']);
export type RoleId = z.infer<typeof RoleIdSchema>;
export const KnowledgeQuerySchema = z.object({
  roleId: RoleIdSchema, skillId: z.string().trim().min(1).max(80),
  purpose: z.enum(['questioning', 'scoring']), query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(3).default(3),
}).strict();
export type KnowledgeQuery = z.infer<typeof KnowledgeQuerySchema>;
export const KnowledgeItemSchema = z.object({
  id: z.string().min(1), roleId: RoleIdSchema, skillId: z.string().min(1),
  questionType: z.enum(['technical', 'project', 'scenario', 'behavioral']),
  difficulty: z.number().int().min(1).max(5), question: z.string().min(1),
  keyPoints: z.array(z.string().min(1)).min(1),
  rubric: z.array(z.object({ criterionId: z.string(), description: z.string(),
    maxScore: z.number().positive(), weight: z.number().positive(),...CriterionMetadata }).strict()
    .refine(c=>(!c.verificationGoal||c.dimension==='verification')&&validAnchors(c.maxScore,c.anchors),'Anchors must be ordered from zero to maxScore.')).min(1),
  sourceIds: z.array(z.string().min(1)).min(1), version: z.string().min(1),
  reviewStatus: z.enum(['draft', 'reviewed']),
}).strict();
export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>;
export const KnowledgeGuidanceSchema = z.object({ itemId: z.string().min(1).max(100), version: z.string().min(1).max(100),
  applicability: z.string().min(1).max(1000), answerGuide: z.string().min(1).max(4000).optional(),
  followups: z.array(z.object({ question: z.string().min(1).max(500), assesses: z.string().min(1).max(500) }).strict()).min(1).max(5),
  sourceReferences: z.array(z.object({ sourceId: z.string().min(1).max(100), sourceVersion: z.string().min(1).max(100), locator: z.string().min(1).max(500) }).strict()).min(1).max(10),
}).strict();
export const ToolContextSchema = z.object({
  userId: z.string().min(1), runId: z.string().min(1), attemptId: z.string().min(1),
  roleId: RoleIdSchema, deadlineAt: z.number().finite().nonnegative(),
}).strict();
export type ToolContext = z.infer<typeof ToolContextSchema>;
export const ErrorCodeSchema = z.enum([
  'VALIDATION_ERROR', 'UNAUTHENTICATED', 'FORBIDDEN', 'ROLE_FORBIDDEN', 'NOT_FOUND',
  'VERSION_CONFLICT', 'RUN_CANCELLED', 'TOOL_BUDGET_EXCEEDED', 'CONTEXT_BUDGET_EXCEEDED', 'RATE_LIMITED',
  'DEPENDENCY_UNAVAILABLE', 'DEADLINE_EXCEEDED', 'MODEL_OUTPUT_INVALID', 'NOT_IMPLEMENTED', 'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export const ToolReceiptSchema = z.object({
  callId: z.string(), toolName: z.literal('query_role_knowledge'),
  status: z.enum(['ok', 'empty', 'error']), sourceIds: z.array(z.string()), durationMs: z.number().nonnegative(),
  data: z.object({ items: z.array(KnowledgeItemSchema), guidance: z.array(KnowledgeGuidanceSchema).max(3).optional() }).strict().optional(),
  error: z.object({ code: ErrorCodeSchema, message: z.string(), retryable: z.boolean() }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.status === 'error' ? (!value.error || !!value.data) : (!value.data || !!value.error))
    ctx.addIssue({ code: 'custom', message: 'Receipt status must agree with data/error.' });
  if (value.status === 'empty' && value.data?.items.length !== 0)
    ctx.addIssue({ code: 'custom', message: 'Empty receipts must have no items.' });
  if (value.status === 'ok' && value.data?.items.length === 0)
    ctx.addIssue({ code: 'custom', message: 'Successful receipts must contain records.' });
  const guidance = value.data?.guidance;
  if (guidance && (new Set(guidance.map(g => g.itemId)).size !== guidance.length || guidance.some(g => {
    const item = value.data!.items.find(i => i.id === g.itemId);
    return !item || new Set(g.sourceReferences.map(r => r.sourceId)).size !== g.sourceReferences.length ||
      g.sourceReferences.some(r => !item.sourceIds.includes(r.sourceId));
  }))) ctx.addIssue({ code: 'custom', message: 'Guidance must bind to unique returned items and their sources.' });
});
export type ToolReceipt = z.infer<typeof ToolReceiptSchema>;
