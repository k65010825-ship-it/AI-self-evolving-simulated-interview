import { createHash } from 'node:crypto';
import { z } from 'zod';
import { KnowledgeWorkspaceSchema } from '../../../../packages/contracts/src/knowledge-curation.ts';
import type { KnowledgeItem } from '../../../../packages/contracts/src/tools.ts';
import { consistentSkillScopes } from '../../../../packages/contracts/src/rubric-dimensions.ts';

const optionsSchema = z.object({ mode: z.enum(['reviewed-only', 'draft-preview']).default('reviewed-only'),
  maxSourceAgeDays: z.number().int().min(1).max(365).default(90) }).strict();
function invalid(): never { throw new Error('KNOWLEDGE_CURATION_INVALID'); }
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
}
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
const unique = (ids: string[]) => ids.length === new Set(ids).size;

/** File-declared review gate, not authentication or production publication. */
export function buildKnowledgeCatalog(raw: unknown, rawOptions: { mode?: 'reviewed-only' | 'draft-preview'; maxSourceAgeDays?: number } = {}) {
  const parsed = KnowledgeWorkspaceSchema.safeParse(raw), opts = optionsSchema.safeParse(rawOptions);
  if (!parsed.success || !opts.success) invalid();
  const w = parsed.data, config = opts.data;
  if (!unique(w.items.map(i => i.id)) || !unique(w.dossiers.map(i => i.itemId)) || !unique(w.sources.map(s => s.id)) ||
    !unique(w.reviews.map(r => r.id)) || !unique(w.reviews.map(r => JSON.stringify([r.itemId, Date.parse(r.reviewedAt)]))) || w.dossiers.length !== w.items.length) invalid();
  const sources = new Map(w.sources.map(s => [s.id, s])), dossiers = new Map(w.dossiers.map(d => [d.itemId, d]));
  const itemsById = new Map(w.items.map(i => [i.id, i]));
  for (const roleId of ['java-backend', 'web-frontend']) if (!consistentSkillScopes(w.items.filter(i => i.roleId === roleId))) invalid();
  for (const s of w.sources) if (s.retrievedAt && Date.parse(s.retrievedAt) > w.now) invalid();
  for (const r of w.reviews) if (!itemsById.has(r.itemId) || Date.parse(r.reviewedAt) > w.now) invalid();
  const catalog: KnowledgeItem[] = [];
  const entries = w.items.map(item => {
    // Authors cannot obtain a released status by editing a flag in the JSON file.
    if (item.reviewStatus !== 'draft' || !unique(item.sourceIds) || !unique(item.rubric.map(c => c.criterionId)) ||
      Math.abs(item.rubric.reduce((n, c) => n + c.weight, 0) - 1) > 1e-9) invalid();
    const dossier = dossiers.get(item.id);
    if (!dossier || dossier.itemVersion !== item.version || Date.parse(dossier.authoredAt) > w.now ||
      !unique(dossier.sourceReferences.map(r => r.sourceId)) ||
      [...item.sourceIds].sort().join() !== dossier.sourceReferences.map(r => r.sourceId).sort().join()) invalid();
    const refs = item.sourceIds.map(id => sources.get(id) ?? invalid()).sort((a, b) => a.id.localeCompare(b.id));
    const readiness: string[] = [];
    if (item.rubric.some(c => !c.dimension || !c.evidenceRule || !c.anchors)) readiness.push('rubric_metadata_missing');
    if (dossier.sourceReferences.some(r => r.sourceVersion !== sources.get(r.sourceId)!.version)) readiness.push('source_version_mismatch');
    for (const source of refs) {
      if (source.url === null) {
        if (source.id !== 'team-original') readiness.push('source_unchecked');
        continue;
      }
      if (source.verificationStatus !== 'content-checked' || !source.retrievedAt) readiness.push('source_unchecked');
      else if (w.now - Date.parse(source.retrievedAt) > config.maxSourceAgeDays * 86400000) readiness.push('source_stale');
    }
    if (['technical', 'scenario'].includes(item.questionType) && !refs.some(s => s.url !== null)) readiness.push('technical_source_missing');
    const contentDigest = hash({ item, dossier }), sourcesDigest = hash(refs);
    const review = w.reviews.filter(r => r.itemId === item.id).sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt))[0];
    const issues = [...new Set(readiness)];
    if (!review) issues.push('review_missing');
    else if (review.itemVersion !== item.version || review.contentDigest !== contentDigest || review.sourcesDigest !== sourcesDigest ||
      Date.parse(review.reviewedAt) < Date.parse(dossier.authoredAt) || refs.some(s => s.retrievedAt && Date.parse(review.reviewedAt) < Date.parse(s.retrievedAt))) issues.push('review_stale');
    else if (review.decision !== 'approved') issues.push('changes_requested');
    else if (!Object.values(review.checks).every(Boolean)) issues.push('review_checks_incomplete');
    const reviewed = issues.length === 0;
    if (reviewed || config.mode === 'draft-preview') catalog.push({ ...item, reviewStatus: reviewed ? 'reviewed' : 'draft' });
    return { itemId: item.id, itemVersion: item.version, roleId: item.roleId, ready: readiness.length === 0,
      reviewStatus: reviewed ? 'reviewed' as const : 'draft' as const, issues, contentDigest, sourcesDigest };
  });
  return { mode: config.mode, authority: 'file-declared-unverified' as const, productionPublished: false as const,
    items: catalog, entries, summary: { total: entries.length, readyForHumanReview: entries.filter(e => e.ready).length,
      reviewed: entries.filter(e => e.reviewStatus === 'reviewed').length, returned: catalog.length } };
}
