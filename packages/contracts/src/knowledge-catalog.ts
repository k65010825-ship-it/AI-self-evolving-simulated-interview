import {z} from 'zod';
import {KnowledgeItemSchema,RoleIdSchema} from './tools.ts';
/** Bounded host snapshot. A digest is content integrity, not authenticated human approval. */
export const KnowledgeCatalogPinSchema=z.object({schemaVersion:z.literal(1),id:z.string().min(1).max(100),
 mode:z.enum(['seed','draft-preview','reviewed-only']),roleId:RoleIdSchema,digest:z.string().regex(/^[a-f0-9]{64}$/),
 items:z.array(KnowledgeItemSchema).max(200)}).strict();
export type KnowledgeCatalogPin=z.infer<typeof KnowledgeCatalogPinSchema>;
