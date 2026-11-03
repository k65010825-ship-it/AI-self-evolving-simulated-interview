import { z } from 'zod';
import { KnowledgeItemSchema } from './tools.ts';

const id = z.string().min(1).max(100);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const KnowledgeSourceSchema = z.object({ id, version: id, title: z.string().min(1).max(500),
  url: z.url().refine(v => v.startsWith('https://')).nullable(), owner: z.string().min(1).max(200),
  licenseNote: z.string().min(1).max(1000), retrievedAt: z.iso.date().nullable(),
  verificationStatus: z.enum(['pending', 'draft', 'content-checked']),
}).strict().refine(s => s.verificationStatus !== 'content-checked' || (s.url !== null && s.retrievedAt !== null), 'Checked external sources require URL and date');
export const KnowledgeDossierSchema = z.object({ itemId: id, itemVersion: id, version: id,
  authoredAt: z.iso.date(), applicability: z.string().min(1).max(1000), answerGuide: z.string().min(1).max(4000),
  followups: z.array(z.object({ question: z.string().min(1).max(500), assesses: z.string().min(1).max(500) }).strict()).min(1).max(5),
  sourceReferences: z.array(z.object({ sourceId: id, sourceVersion: id, locator: z.string().min(1).max(500) }).strict()).min(1).max(10),
}).strict();
export const KnowledgeReviewSchema = z.object({ id, itemId: id, itemVersion: id, contentDigest: digest, sourcesDigest: digest,
  decision: z.enum(['approved', 'changes_requested']), reviewerId: id, reviewedAt: z.iso.datetime(),
  checks: z.object({ technicalAccuracy: z.boolean(), scoringClarity: z.boolean(), sourceAlignment: z.boolean(), roleFit: z.boolean() }).strict(),
}).strict();
export const KnowledgeWorkspaceSchema = z.object({ items: z.array(KnowledgeItemSchema).min(1).max(400),
  dossiers: z.array(KnowledgeDossierSchema).min(1).max(400), sources: z.array(KnowledgeSourceSchema).min(1).max(100),
  reviews: z.array(KnowledgeReviewSchema).max(2000), now: z.number().int().nonnegative(),
}).strict();
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>;
export type KnowledgeDossier = z.infer<typeof KnowledgeDossierSchema>;
export type KnowledgeReview = z.infer<typeof KnowledgeReviewSchema>;
export type KnowledgeWorkspace = z.infer<typeof KnowledgeWorkspaceSchema>;
