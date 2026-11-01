import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { KnowledgeItemSchema } from '../packages/contracts/src/tools.ts';
const sources = JSON.parse(await readFile(new URL('../knowledge/sources.json', import.meta.url), 'utf8')) as { id: string }[];
const sourceIds = new Set(sources.map((source) => source.id));
if (sourceIds.size !== sources.length) throw new Error('Duplicate source identifiers');
const ids = new Set<string>();
for (const role of ['java-backend', 'web-frontend'] as const) {
  const items = z.array(KnowledgeItemSchema).parse(JSON.parse(await readFile(new URL(`../knowledge/${role}/seed.json`, import.meta.url), 'utf8')));
  const kinds = new Set(items.map((item) => item.questionType));
  if (kinds.size !== 4) throw new Error(`Missing question types: ${role}`);
  for (const item of items) {
    if (ids.has(item.id) || item.roleId !== role) throw new Error('Duplicate identifier or role mismatch');
    ids.add(item.id);
    if (item.sourceIds.some((id) => !sourceIds.has(id))) throw new Error(`Unknown source: ${item.id}`);
    const weight = item.rubric.reduce((total, criterion) => total + criterion.weight, 0);
    if (Math.abs(weight - 1) > 1e-9) throw new Error(`Rubric weights do not sum to 1: ${item.id}`);
  }
  console.log(`${role}: ${items.length} draft items; four question types; references/schema/weights valid`);
}
console.log('This is structural quality checking, not expert content review or source-page verification.');
