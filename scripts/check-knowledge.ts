import { readFile } from 'node:fs/promises';
import { loadKnowledgeWorkspace } from '../apps/agent/src/knowledge/catalog.ts';
import { buildKnowledgeCatalog } from '../apps/agent/src/knowledge/curation.ts';
import { ResourceCatalogSchema } from '../packages/contracts/src/resources.ts';
const workspace = loadKnowledgeWorkspace();
const sources = workspace.sources;
const catalog = buildKnowledgeCatalog(workspace, { mode: 'draft-preview' });
const sourceIds = new Set(sources.map((source) => source.id));
if (sourceIds.size !== sources.length) throw new Error('Duplicate source identifiers');
const ids = new Set<string>();
for (const role of ['java-backend', 'web-frontend'] as const) {
  const items = catalog.items.filter(i => i.roleId === role);
  const kinds = new Set(items.map((item) => item.questionType));
  if (kinds.size !== 4) throw new Error(`Missing question types: ${role}`);
  for (const item of items) {
    if (ids.has(item.id) || item.roleId !== role) throw new Error('Duplicate identifier or role mismatch');
    ids.add(item.id);
    if (item.sourceIds.some((id) => !sourceIds.has(id))) throw new Error(`Unknown source: ${item.id}`);
    const weight = item.rubric.reduce((total, criterion) => total + criterion.weight, 0);
    if (Math.abs(weight - 1) > 1e-9) throw new Error(`Rubric weights do not sum to 1: ${item.id}`);
  }
  console.log(`${role}: ${items.length} items (${items.filter(i => i.reviewStatus === 'draft').length} draft); four question types; references/schema/weights valid`);
}
console.log(`Review gate: ${catalog.summary.readyForHumanReview}/${catalog.summary.total} structurally ready; ${catalog.summary.reviewed} reviewed; no automatic approvals or publication.`);
console.log('This is structural quality checking, not expert content review or source-page verification.');
const resources = ResourceCatalogSchema.parse(JSON.parse(await readFile(new URL('../knowledge/resources.json', import.meta.url), 'utf8')));
for (const resource of resources.items) {
  if (resource.sourceIds.some(id => !sourceIds.has(id))) throw new Error(`Unknown resource source: ${resource.id}`);
}
console.log(`Resource catalog ${resources.version}: ${resources.items.length} records; URLs/allowlist/references/schema valid. Review/freshness checked at execution.`);
