import { test, expect } from 'bun:test';
import { buildKnowledgeCatalog } from '../apps/agent/src/knowledge/curation.ts';

// Synthetic approval records only exercise the gate; no human approval is claimed or saved.
function fixture() {
  return { now: Date.parse('2026-11-03T12:00:00Z'), items: [{ id: 'fixture-question', roleId: 'java-backend', skillId: 'java-concurrency',
    questionType: 'technical', difficulty: 1, question: '解释可见性', keyPoints: ['区分原子性'], version: 'q-1', reviewStatus: 'draft', sourceIds: ['official'],
    rubric: [{ criterionId: 'correctness', dimension: 'correctness', description: '保证边界', maxScore: 4, weight: 1, evidenceRule: '引用原文',
      anchors: [{ score: 0, description: '明确错误' }, { score: 4, description: '边界完整' }] }] }],
    dossiers: [{ itemId: 'fixture-question', itemVersion: 'q-1', version: 'd-1', applicability: 'Java 21', authoredAt: '2026-11-03',
      answerGuide: '可见性不保证复合更新原子性。', followups: [{ question: '怎样保护复合操作？', assesses: '同步边界' }],
      sourceReferences: [{ sourceId: 'official', sourceVersion: 'doc-1', locator: '相关章节' }] }],
    sources: [{ id: 'official', version: 'doc-1', title: '规范', url: 'https://docs.oracle.com/example', owner: 'Oracle', licenseNote: '仅链接与原创要点',
      retrievedAt: '2026-11-03', verificationStatus: 'content-checked' }], reviews: [] as unknown[] };
}
function approval(f: ReturnType<typeof fixture>) {
  const item = buildKnowledgeCatalog(f, { mode: 'draft-preview' }).entries[0]!;
  return { id: 'synthetic-review', itemId: item.itemId, itemVersion: 'q-1', contentDigest: item.contentDigest, sourcesDigest: item.sourcesDigest,
    decision: 'approved', reviewerId: 'synthetic-reviewer-not-a-real-approval', reviewedAt: '2026-11-03T10:00:00Z',
    checks: { technicalAccuracy: true, scoringClarity: true, sourceAlignment: true, roleFit: true } };
}

test('default curated catalog excludes drafts while explicit preview preserves the draft label', () => {
  const f = fixture();
  expect(buildKnowledgeCatalog(f).items).toHaveLength(0);
  expect(buildKnowledgeCatalog(f, { mode: 'draft-preview' }).items[0]!.reviewStatus).toBe('draft');
  f.items[0]!.reviewStatus = 'reviewed';
  expect(() => buildKnowledgeCatalog(f)).toThrow('KNOWLEDGE_CURATION_INVALID');
});

test('only exact latest approval with complete checks can derive reviewed content', () => {
  const f = fixture(); f.reviews.push(approval(f));
  expect(buildKnowledgeCatalog(f).items[0]!.reviewStatus).toBe('reviewed');
  const changed = structuredClone(f); changed.dossiers[0]!.answerGuide += '改动';
  expect(buildKnowledgeCatalog(changed).items).toHaveLength(0);
  expect(buildKnowledgeCatalog(changed).entries[0]!.issues).toContain('review_stale');
  const source = structuredClone(f); source.sources[0]!.title = '文档元数据变化';
  expect(buildKnowledgeCatalog(source).items).toHaveLength(0);
  const denied = structuredClone(f); denied.reviews.push({ ...approval(f), id: 'reject', decision: 'changes_requested', reviewedAt: '2026-11-03T11:00:00Z' });
  expect(buildKnowledgeCatalog(denied).items).toHaveLength(0);
  const unchecked = structuredClone(f); (unchecked.reviews[0] as ReturnType<typeof approval>).checks.roleFit = false;
  expect(buildKnowledgeCatalog(unchecked).items).toHaveLength(0);
});

test('source version, freshness and rubric readiness block approval without pretending content is reviewed', () => {
  const f = fixture(); f.reviews.push(approval(f));
  f.dossiers[0]!.sourceReferences[0]!.sourceVersion = 'old';
  expect(buildKnowledgeCatalog(f).entries[0]!.issues).toContain('source_version_mismatch');
  const stale = fixture(); stale.sources[0]!.retrievedAt = '2025-01-01';
  expect(buildKnowledgeCatalog(stale).entries[0]!.issues).toContain('source_stale');
  const incomplete = fixture(); delete (incomplete.items[0]!.rubric[0] as Record<string, unknown>).evidenceRule;
  expect(buildKnowledgeCatalog(incomplete).entries[0]!.issues).toContain('rubric_metadata_missing');
});

test('duplicate identities, orphan dossiers/reviews, future timestamps and weight errors are rejected', () => {
  const f = fixture();
  expect(() => buildKnowledgeCatalog({ ...f, items: [...f.items, f.items[0]] })).toThrow('KNOWLEDGE_CURATION_INVALID');
  expect(() => buildKnowledgeCatalog({ ...f, dossiers: [] })).toThrow('KNOWLEDGE_CURATION_INVALID');
  expect(() => buildKnowledgeCatalog({ ...f, reviews: [{ ...approval(f), itemId: 'unknown' }] })).toThrow('KNOWLEDGE_CURATION_INVALID');
  expect(() => buildKnowledgeCatalog({ ...f, reviews: [{ ...approval(f), reviewedAt: '2027-01-01T00:00:00Z' }] })).toThrow('KNOWLEDGE_CURATION_INVALID');
  f.items[0]!.rubric[0]!.weight = 0.5;
  expect(() => buildKnowledgeCatalog(f)).toThrow('KNOWLEDGE_CURATION_INVALID');
});

test('equivalent timestamps cannot make an approval hide a simultaneous rejection', () => {
  const f = fixture(), approved = approval(f);
  f.reviews.push(approved, { ...approved, id: 'reject-same-instant', decision: 'changes_requested', reviewedAt: '2026-11-03T10:00:00.000Z' });
  expect(() => buildKnowledgeCatalog(f)).toThrow('KNOWLEDGE_CURATION_INVALID');
});
