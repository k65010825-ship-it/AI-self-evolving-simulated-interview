import manifest from './manifest.json' with { type: 'json' };
import cases from './cases.json' with { type: 'json' };
import references from './references.json' with { type: 'json' };
import { AnswerBundleSchema } from '../../packages/contracts/src/answer-benchmark.ts';
import { RubricSchema } from '../../packages/contracts/src/scoring.ts';
import { loadKnowledgeWorkspace } from '../../apps/agent/src/knowledge/catalog.ts';
import { buildKnowledgeCatalog } from '../../apps/agent/src/knowledge/curation.ts';
import type { KnowledgeWorkspace } from '../../packages/contracts/src/knowledge-curation.ts';
import type { KnowledgeItem } from '../../packages/contracts/src/tools.ts';
import { contentHash, validateBenchmarkAssessment } from './validation.ts';
export const getBenchmarkKnowledge = () => loadKnowledgeWorkspace();
export const loadAnswerBundle = () => AnswerBundleSchema.parse({ manifest, cases, references });
export function benchmarkRubric(item: KnowledgeItem) {
  return RubricSchema.parse({ id: item.id, version: item.version, roleId: item.roleId,
    scope: item.questionType === 'behavioral' ? 'behavioral-content' : 'technical-content',
    criteria: item.rubric.map(c => ({ id: c.criterionId, maxScore: c.maxScore, weight: c.weight, required: false,
      description: c.description, dimension: c.dimension, evidenceRule: c.evidenceRule, anchors: c.anchors })) });
}
function invalid(): never { throw new Error('ANSWER_DATASET_INVALID'); }
export function compileAnswerDataset(raw: unknown, knowledge: KnowledgeWorkspace) {
  const p = AnswerBundleSchema.safeParse(raw); if (!p.success) invalid();
  const b = p.data, catalog = buildKnowledgeCatalog(knowledge, { mode: 'draft-preview' });
  if (Date.parse(b.manifest.authoredAt) > knowledge.now) invalid();
  const unique = (v: string[]) => v.length === new Set(v).size;
  if (!unique(b.cases.map(c => c.id)) || !unique(b.references.map(r => r.caseId)) || b.cases.length !== b.references.length ||
    !unique(b.manifest.knowledgePins.map(p => p.questionId))) invalid();
  const questionIds = [...new Set(b.cases.map(c => c.questionId))].sort();
  if (questionIds.join() !== b.manifest.knowledgePins.map(p => p.questionId).sort().join()) invalid();
  const groupSplits = new Map<string, string>(), questionGroups = new Map<string, string>(), answerSplits = new Map<string, string>();
  const samples = b.cases.map(c => {
    const groupSplit = groupSplits.get(c.groupId), oldGroup = questionGroups.get(c.questionId);
    const normalized = c.answer.normalize('NFKC').replace(/\s+/gu, '').toLowerCase(), answerSplit = answerSplits.get(normalized);
    if ((groupSplit && groupSplit !== c.split) || (oldGroup && oldGroup !== c.groupId) || (answerSplit && answerSplit !== c.split)) invalid();
    groupSplits.set(c.groupId, c.split); questionGroups.set(c.questionId, c.groupId); answerSplits.set(normalized, c.split);
    const item = catalog.items.find(i => i.id === c.questionId), entry = catalog.entries.find(e => e.itemId === c.questionId), pin = b.manifest.knowledgePins.find(p => p.questionId === c.questionId)!;
    if (!item || !entry || !entry.ready || pin.contentDigest !== entry.contentDigest || pin.sourcesDigest !== entry.sourcesDigest) throw new Error('ANSWER_DATASET_STALE');
    const rubric = benchmarkRubric(item), reference = b.references.find(r => r.caseId === c.id);
    if (!reference || reference.caseDigest !== contentHash(c) || reference.rubricDigest !== contentHash(rubric)) invalid();
    try { validateBenchmarkAssessment(reference.assessment, rubric, c.answer); } catch { invalid(); }
    return { case: c, reference, rubric, question: { id: item.id, version: item.version, roleId: item.roleId, skillId: item.skillId,
      text: item.question, questionType: item.questionType, difficulty: item.difficulty } };
  });
  return { id: b.manifest.id, version: b.manifest.version, digest: contentHash(b), humanReferenceCount: 0 as const, samples };
}
export type CompiledAnswerDataset = ReturnType<typeof compileAnswerDataset>;
