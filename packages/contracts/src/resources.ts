import { z } from 'zod';
import { RoleIdSchema, ErrorCodeSchema } from './tools.ts';
const id = z.string().trim().min(1).max(100);
export const ResourceLevelSchema = z.enum(['foundational', 'intermediate', 'advanced']);
export const ResourceQuerySchema = z.object({ roleId: RoleIdSchema, skillId: id, level: ResourceLevelSchema,
  limit: z.number().int().min(1).max(3).default(2) }).strict();
export const ResourceRecordSchema = z.object({ id, roleId: RoleIdSchema, skillIds: z.array(id).min(1).max(30),
  title: z.string().min(1).max(200), url: z.url().max(2000), provider: z.string().min(1).max(100),
  level: ResourceLevelSchema, sourceIds: z.array(id).min(1).max(10), version: id,
  reviewStatus: z.enum(['draft', 'reviewed']), availability: z.enum(['available', 'unavailable']),
  verificationStatus: z.enum(['content-checked', 'pending', 'broken']), lastCheckedAt: z.number().int().nonnegative().nullable(),
}).strict();
export const ResourceCatalogSchema = z.object({ version: id,
  allowedHosts: z.array(z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/)).min(1).max(100),
  items: z.array(ResourceRecordSchema).max(1000),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.items.map(i => i.id)).size !== v.items.length) ctx.addIssue({ code: 'custom', message: 'Duplicate resource ID.' });
  for (const item of v.items) {
    if (!URL.canParse(item.url)) {
      ctx.addIssue({ code: 'custom', message: 'Invalid resource URL.' }); continue;
    }
    const url = new URL(item.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !v.allowedHosts.includes(url.hostname))
      ctx.addIssue({ code: 'custom', message: 'Only credential-free HTTPS URLs on exact allowed hosts are permitted.' });
  }
});
export const ResourceReceiptSchema = z.object({ callId: z.string(), toolName: z.literal('search_learning_resources'),
  status: z.enum(['ok', 'empty', 'error']), sourceIds: z.array(id), durationMs: z.number().nonnegative(),
  data: z.object({ catalogVersion: id, items: z.array(ResourceRecordSchema).max(3) }).strict().optional(),
  error: z.object({ code: ErrorCodeSchema, message: z.string(), retryable: z.boolean() }).strict().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.status === 'error' ? (!v.error || !!v.data) : (!v.data || !!v.error)) ctx.addIssue({ code: 'custom', message: 'Invalid receipt branch.' });
  if (v.data && ((v.status === 'empty') !== (v.data.items.length === 0))) ctx.addIssue({ code: 'custom', message: 'Invalid empty status.' });
});
export const ResourceRecommendationSchema = z.object({ skillId: id,
  reason: z.enum(['assess_unknown', 'repair_gap', 'verify_uncertainty']), explanation: z.string().min(1).max(500),
  catalogVersion: id, resource: ResourceRecordSchema, learningStatus: z.literal('not_started') }).strict();
export type ResourceReceipt = z.infer<typeof ResourceReceiptSchema>;
