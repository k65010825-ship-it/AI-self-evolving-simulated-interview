import { test, expect } from 'bun:test';
import { compileAnswerDataset, loadAnswerBundle, getBenchmarkKnowledge } from '../evals/answers/dataset.ts';
import { analyzeAnswerRows, sealAnswerReport, verifyAnswerReport } from '../evals/answers/metrics.ts';

function fixture() {
  const dataset = compileAnswerDataset(loadAnswerBundle(), getBenchmarkKnowledge());
  const rows = dataset.samples.filter(s => s.case.split === 'development').map(s => ({ caseId: s.case.id, roleId: s.question.roleId,
    questionId: s.question.id, rubricVersion: s.rubric.version, status: 'completed' as const,
    scores: s.rubric.criteria.map(c => ({ criterionId: c.id, score: c.maxScore / 2 })), assessmentDigest: 'a'.repeat(64) }));
  return { dataset, rows };
}
test('per-role MAE uses scored pairs only and exposes null disagreement instead of turning null into zero', () => {
  const { dataset, rows } = fixture(), r = analyzeAnswerRows(dataset, 'development', rows);
  for (const role of r.roles) {
    expect(role.criterionError).toEqual({ sumAbsoluteError: 2, sumSignedError: 0, pairedCount: 4, mae: .5, bias: 0 });
    expect(role.weightedError.pairedCount).toBe(2);
    expect(role.weightedError.mae).toBeCloseTo(.5);
    expect(role.nullAgreement.overScored).toBe(2);
    expect(role.humanReferenceMae).toBeNull();
  }
});
test('failed and abstaining cases remain in denominators; missing or duplicate rows cannot improve reported coverage', () => {
  const { dataset, rows } = fixture();
  const failed = rows.map(r => ({ caseId: r.caseId, roleId: r.roleId, questionId: r.questionId, rubricVersion: r.rubricVersion,
    status: 'failed', error: 'MODEL_OUTPUT_INVALID' }));
  const result = analyzeAnswerRows(dataset, 'development', failed);
  expect(result.roles.every(r => r.failureCount === 3 && r.criterionError.mae === null)).toBe(true);
  expect(() => analyzeAnswerRows(dataset, 'development', rows.slice(1))).toThrow('ANSWER_REPORT_INVALID');
  expect(() => analyzeAnswerRows(dataset, 'development', [...rows.slice(1), rows[1]])).toThrow('ANSWER_REPORT_INVALID');
  const abstain = rows.map(r => ({ ...r, scores: r.scores.map(c => ({ ...c, score: null })) }));
  const a = analyzeAnswerRows(dataset, 'development', abstain);
  expect(a.roles.every(r => r.criterionError.mae === null && r.nullAgreement.underScored === 4 && r.nullAgreement.bothMissing === 2)).toBe(true);
});
test('report validation recomputes metrics and checks data binding, but never claims prediction authenticity', () => {
  const { dataset, rows } = fixture();
  const report = sealAnswerReport(dataset, { split: 'development', rows, evaluatorId: 'half-score-offline-fixture',
    startedAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString() });
  expect(verifyAnswerReport(report, dataset)).toEqual(report);
  const changed = structuredClone(report); changed.analysis.roles[0]!.criterionError.mae = 0;
  expect(() => verifyAnswerReport(changed, dataset)).toThrow('ANSWER_REPORT_INVALID');
  expect(() => analyzeAnswerRows(dataset, 'reserved-final', [])).toThrow('ANSWER_SPLIT_FORBIDDEN');
});

test('partial predictions do not become complete weighted scores; wrong roles and out-of-range scores fail', () => {
  const { dataset, rows } = fixture();
  const typed = rows.map(r => ({ ...r, scores: r.scores.map((c, i) => ({ ...c, score: i === 0 ? c.score : null })) }));
  const a = analyzeAnswerRows(dataset, 'development', typed);
  expect(a.roles.every(r => r.weightedError.mae === null && r.weightedError.pairedCount === 0 && r.fullyScoredCount === 0)).toBe(true);
  const wrong = structuredClone(rows); wrong[0]!.roleId = 'web-frontend';
  expect(() => analyzeAnswerRows(dataset, 'development', wrong)).toThrow('ANSWER_REPORT_INVALID');
  const excessive = structuredClone(rows); excessive[0]!.scores[0]!.score = 99;
  expect(() => analyzeAnswerRows(dataset, 'development', excessive)).toThrow('ANSWER_REPORT_INVALID');
});
