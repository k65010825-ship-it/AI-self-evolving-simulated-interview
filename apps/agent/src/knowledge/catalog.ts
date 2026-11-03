import javaSeed from '../../../../knowledge/java-backend/seed.json' with { type: 'json' };
import webSeed from '../../../../knowledge/web-frontend/seed.json' with { type: 'json' };
import javaExpansion from '../../../../knowledge/java-backend/expansion.json' with { type: 'json' };
import webExpansion from '../../../../knowledge/web-frontend/expansion.json' with { type: 'json' };
import sources from '../../../../knowledge/sources.json' with { type: 'json' };
import dossiers from '../../../../knowledge/dossiers.json' with { type: 'json' };
import reviews from '../../../../knowledge/reviews.json' with { type: 'json' };
import { KnowledgeWorkspaceSchema } from '../../../../packages/contracts/src/knowledge-curation.ts';
import { KnowledgeQuerySchema, ToolReceiptSchema, type ToolContext } from '../../../../packages/contracts/src/tools.ts';
import { buildKnowledgeCatalog } from './curation.ts';
import { createKnowledgeExecutor } from '../tools/knowledge-executor.ts';

export function loadKnowledgeWorkspace(now = Date.now()) {
  return KnowledgeWorkspaceSchema.parse({ items: [...javaSeed, ...javaExpansion, ...webSeed, ...webExpansion], sources, dossiers, reviews, now });
}
/** Host-only selection; model parameters cannot opt into drafts or replace this catalog. */
export function createCuratedKnowledgeExecutor(context: ToolContext, options: { mode?: 'reviewed-only' | 'draft-preview'; maxCalls?: number } = {}) {
  const workspace = loadKnowledgeWorkspace(), catalog = buildKnowledgeCatalog(workspace, options.mode === undefined ? {} : { mode: options.mode });
  const execute = createKnowledgeExecutor(context, { catalog: catalog.items, includeDrafts: catalog.mode === 'draft-preview',
    ...(options.maxCalls === undefined ? {} : { maxCalls: options.maxCalls }) });
  const guides = new Map(workspace.dossiers.map(d => [d.itemId, d]));
  return async (callId: string, raw: unknown, signal?: AbortSignal) => {
    const receipt = await execute(callId, raw, signal);
    if (receipt.status === 'error' || !receipt.data) return receipt;
    const query = KnowledgeQuerySchema.parse(raw);
    return ToolReceiptSchema.parse({ ...receipt, data: { ...receipt.data, guidance: receipt.data.items.map(item => {
      const d = guides.get(item.id)!;
      return { itemId: item.id, version: d.version, applicability: d.applicability, followups: d.followups, sourceReferences: d.sourceReferences,
        ...(query.purpose === 'scoring' ? { answerGuide: d.answerGuide } : {}) };
    }) } });
  };
}
