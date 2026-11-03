import { test, expect } from 'bun:test';
import { loadAnswerBundle, compileAnswerDataset, getBenchmarkKnowledge } from '../evals/answers/dataset.ts';

test('draft reference corpus has 18 synthetic answers, disjoint question families and pinned source rubrics', () => {
  const d = compileAnswerDataset(loadAnswerBundle(), getBenchmarkKnowledge());
  expect(d.samples).toHaveLength(18);
  expect(d.humanReferenceCount).toBe(0);
  for (const split of ['development', 'validation', 'reserved-final']) expect(d.samples.filter(s => s.case.split === split)).toHaveLength(6);
  expect(d.samples.every(s => s.rubric.criteria.every(c => !c.required))).toBe(true);
});

test('overlapping groups, question variants and copied normalized answers cannot cross splits', () => {
  const b = loadAnswerBundle();
  const dev = b.cases.find(c => c.split === 'development')!, validation = b.cases.find(c => c.split === 'validation')!;
  const group = structuredClone(b); group.cases.find(c => c.id === validation.id)!.groupId = dev.groupId;
  expect(() => compileAnswerDataset(group, getBenchmarkKnowledge())).toThrow('ANSWER_DATASET_INVALID');
  const question = structuredClone(b); question.cases.find(c => c.id === validation.id)!.questionId = dev.questionId;
  expect(() => compileAnswerDataset(question, getBenchmarkKnowledge())).toThrow('ANSWER_DATASET_INVALID');
  const copied = structuredClone(b); copied.cases.find(c => c.id === validation.id)!.answer = ` ${dev.answer}\n`;
  expect(() => compileAnswerDataset(copied, getBenchmarkKnowledge())).toThrow('ANSWER_DATASET_INVALID');
});

test('modified answers, reference evidence, rubric pins and sources invalidate the reference binding', () => {
  const b = loadAnswerBundle();
  const changed = structuredClone(b); changed.cases[0]!.answer += '变更';
  expect(() => compileAnswerDataset(changed, getBenchmarkKnowledge())).toThrow('ANSWER_DATASET_INVALID');
  const evidence = structuredClone(b); evidence.references[0]!.assessment.evidence[0]!.excerpt = 'invented';
  expect(() => compileAnswerDataset(evidence, getBenchmarkKnowledge())).toThrow('ANSWER_DATASET_INVALID');
  const duplicateEvidence = structuredClone(b); duplicateEvidence.references[0]!.assessment.criterionScores[0]!.evidenceIds = ['e1', 'e1'];
  expect(() => compileAnswerDataset(duplicateEvidence, getBenchmarkKnowledge())).toThrow('ANSWER_DATASET_INVALID');
  const pin = structuredClone(b); pin.manifest.knowledgePins[0]!.contentDigest = '0'.repeat(64);
  expect(() => compileAnswerDataset(pin, getBenchmarkKnowledge())).toThrow('ANSWER_DATASET_STALE');
  const source = getBenchmarkKnowledge(); source.sources[0]!.title += 'changed';
  // Select a used source rather than assuming catalog order.
  source.sources.forEach(s => s.title += 'changed');
  expect(() => compileAnswerDataset(b, source)).toThrow('ANSWER_DATASET_STALE');
});
