import { test, expect } from 'bun:test';
import { createInterviewState } from '../apps/agent/src/planning/interview-state.ts';
import { evaluateTurn } from '../apps/agent/src/orchestration/evaluate-turn.ts';
import { buildInterviewReport } from '../apps/agent/src/reporting/build-report.ts';
const now = 1000000;
const initial = () => createInterviewState({ sessionId: 'report-session', roleId: 'java-backend', durationMinutes: 20,
  skills: [{ skillId: 'transactions', relevance: 1 }, { skillId: 'concurrency', relevance: 0.9 }] }, now);
const labels = { transactions: '事务边界', concurrency: '并发控制' };
async function fixture() {
  const input = { state: initial(), expectedVersion: 0, observationId: 'o1', goal: '事务练习',
    context: { userId: 'u', runId: 'r', attemptId: 'a', roleId: 'java-backend', deadlineAt: now + 60000 },
    question: { id: 'q1', roleId: 'java-backend', skillId: 'transactions', text: '解释事务边界', questionType: 'technical', difficulty: 2 },
    answer: { id: 'a1', text: '事务边界' }, quality: 0.8, knowledge: [],
    rubric: { id: 'rubric', version: '1', roleId: 'java-backend', scope: 'technical-content',
      criteria: [{ id: 'correctness', maxScore: 4, weight: 1, required: true, description: '解释正确' }] } };
  const proposal = await evaluateTurn(input, { now: () => now, evaluate: async () => ({
    evidence: [{ id: 'e1', start: 0, end: 4, excerpt: '事务边界' }],
    criterionScores: [{ criterionId: 'correctness', score: 1, evidenceIds: ['e1'] }],
    feedback: { strengths: ['提及边界'], improvements: ['补充失败回滚条件'] } }) });
  return { state: proposal.nextState, generatedAt: now + 1000, policyVersion: 'policy-v0', skillLabels: { ...labels },
    turns: [{ input, proposal, evidenceMode: 'offline-fixture' }] };
}
test('builds a content-only uncommitted report with traceable per-turn scores and missing audio', async () => {
  const report = await buildInterviewReport(await fixture());
  expect(report.kind).toBe('uncommitted-content-report'); expect(report.evidenceMode).toBe('offline-fixture');
  expect(report.assessments[0]?.evaluation.normalizedScore).toBe(0.25);
  expect(report.assessments[0]?.rubricVersion).toBe('1'); expect(report.assessments[0]?.evidence[0]?.excerpt).toBe('事务边界');
  expect(report.expression.speechRate).toBeNull(); expect(report.expression.confidence).toBeNull();
  expect('overallScore' in report).toBe(false);
});
test('empty evidence stays unknown, creating assessment tasks rather than inventing weak grades', async () => {
  const report = await buildInterviewReport({ state: initial(), generatedAt: now, policyVersion: 'v0', skillLabels: labels, turns: [] });
  expect(report.skills.every(s => s.mastery === null)).toBe(true);
  expect(report.coverage.observedSkills).toBe(0); expect(report.studyPlan[0]?.reason).toBe('assess_unknown');
  expect(report.assessments).toHaveLength(0); expect(report.resourceRecommendations).toEqual([]);
});
test('weak skills receive actionable practice with cited answer and a different-question retest', async () => {
  const report = await buildInterviewReport(await fixture());
  const task = report.studyPlan.find(p => p.skillId === 'transactions');
  if (!task) throw new Error('Expected practice task');
  expect(task.reason).toBe('repair_gap'); expect(task.actions[0]).toContain('解释正确');
  expect(task.feedbackRefs).toEqual([{answerId:'a1',criterionId:'correctness'}]);
  expect(report.assessments[0]?.feedback.improvements).toContain('补充失败回滚条件');
  expect(task.evidenceAnswerIds).toEqual(['a1']); expect(task.retest.excludeQuestionIds).toEqual(['q1']);
  expect(task.retest.requireDifferentQuestion).toBe(true);
});
test('recomputes scores rather than trusting a tampered normalized value', async () => {
  const raw = await fixture(); raw.turns[0]!.proposal.evaluation.normalizedScore = 1;
  await expect(buildInterviewReport(raw)).rejects.toThrow('VALIDATION_ERROR');
});
test('rejects wrong answer links, forged excerpts and rubric version mismatch', async () => {
  const a = await fixture(); a.turns[0]!.proposal.basedOn.answerId = 'other';
  const b = await fixture(); b.turns[0]!.proposal.evidence[0]!.excerpt = '伪造摘录';
  const c = await fixture(); c.turns[0]!.proposal.evaluation.rubricVersion = 'old';
  for (const bad of [a,b,c]) await expect(buildInterviewReport(bad)).rejects.toThrow('VALIDATION_ERROR');
});
test('requires one record per observation and rejects duplicated answers/records', async () => {
  const a = await fixture(); a.turns = [];
  await expect(buildInterviewReport(a)).rejects.toThrow('VALIDATION_ERROR');
  const b = await fixture(); b.turns.push(b.turns[0]!);
  await expect(buildInterviewReport(b)).rejects.toThrow('VALIDATION_ERROR');
});
test('rejects cross-role records and wrong session', async () => {
  const a = await fixture(); a.turns[0]!.input.context.roleId = 'web-frontend';
  await expect(buildInterviewReport(a)).rejects.toThrow('ROLE_FORBIDDEN');
  const b = await fixture(); b.turns[0]!.proposal.basedOn.sessionId = 'other';
  await expect(buildInterviewReport(b)).rejects.toThrow('VALIDATION_ERROR');
});
test('rejects report clocks before evidence, missing labels and invalid state-score linkage', async () => {
  const a = await fixture(); a.generatedAt = now - 1;
  const b = await fixture(); delete (b.skillLabels as Partial<typeof labels>).transactions;
  const c = await fixture(); c.state.observations[0]!.score = 0.9;
  for (const bad of [a,b,c]) await expect(buildInterviewReport(bad)).rejects.toThrow('VALIDATION_ERROR');
});
test('does not mutate the source snapshot', async () => {
  const raw = await fixture(); const before = JSON.stringify(raw); await buildInterviewReport(raw);
  expect(JSON.stringify(raw)).toBe(before);
});
test('repeated questions do not inflate independent coverage, and mixed provenance stays visible', async () => {
  const raw = await fixture(); const first = raw.turns[0]!;
  const input = structuredClone(first.input); input.state = raw.state; input.expectedVersion = raw.state.version;
  input.observationId = 'o2'; input.answer.id = 'a2';
  const proposal = await evaluateTurn(input, { now: () => now + 100, evaluate: async () => ({
    evidence: first.proposal.evidence, criterionScores: [{ criterionId: 'correctness', score: 1, evidenceIds: ['e1'] }],
    feedback: first.proposal.feedback }) });
  raw.turns.push({ input, proposal, evidenceMode: 'live-model' }); raw.state = proposal.nextState;
  const report = await buildInterviewReport(raw);
  expect(report.coverage.totalAnswers).toBe(2); expect(report.coverage.independentQuestions).toBe(1);
  expect(report.evidenceMode).toBe('mixed'); expect(report.skills[0]?.mastery).toBe(0.25);
});
test('handles records arriving out of order while requiring one consistent snapshot chain', async () => {
  const raw = await fixture(); const first = raw.turns[0]!;
  const input = structuredClone(first.input); input.state = raw.state; input.expectedVersion = 1;
  input.observationId = 'o2'; input.question.id = 'q2'; input.answer.id = 'a2'; input.rubric.version = '2';
  const proposal = await evaluateTurn(input, { now: () => now + 100, evaluate: async () => ({
    evidence: first.proposal.evidence, criterionScores: [{ criterionId: 'correctness', score: 1, evidenceIds: ['e1'] }],
    feedback: first.proposal.feedback }) });
  raw.turns.unshift({ input, proposal, evidenceMode: 'offline-fixture' }); raw.state = proposal.nextState;
  const report = await buildInterviewReport(raw);
  expect(report.assessments.map(a => a.answerId)).toEqual(['a1','a2']);
  expect(report.warnings).toContain('mixed_rubrics:transactions');
  const changed = structuredClone(raw); changed.turns[0]!.input.state.difficulty = 5;
  await expect(buildInterviewReport(changed)).rejects.toThrow('VALIDATION_ERROR');
});
