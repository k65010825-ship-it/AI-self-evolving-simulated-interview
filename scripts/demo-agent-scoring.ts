import { createScoringExecutor } from '../apps/agent/src/tools/scoring-executor.ts';
// 示例权重用于验证计算，没有经过人工标注集校准。
const demoRubrics = [
  { id: 'java-content', version: 'draft-1', roleId: 'java-backend', scope: 'technical-content', criteria: [
    { id: 'correctness', maxScore: 4, weight: 0.4, required: true },
    { id: 'transaction-depth', maxScore: 4, weight: 0.25, required: true },
    { id: 'failure-recovery', maxScore: 4, weight: 0.2, required: true },
    { id: 'reasoning', maxScore: 4, weight: 0.15, required: true }] },
  { id: 'web-content', version: 'draft-1', roleId: 'web-frontend', scope: 'technical-content', criteria: [
    { id: 'correctness', maxScore: 4, weight: 0.35, required: true },
    { id: 'async-state', maxScore: 4, weight: 0.3, required: true },
    { id: 'interaction-accessibility', maxScore: 4, weight: 0.2, required: true },
    { id: 'reasoning', maxScore: 4, weight: 0.15, required: true }] },
];
for (const rubric of demoRubrics) {
  const answerText = rubric.roleId === 'java-backend' ? '事务边界与失败恢复' : '异步状态与无障碍交互';
  const run = createScoringExecutor({ userId: 'demo', runId: 'demo', attemptId: 'demo', roleId: rubric.roleId,
    deadlineAt: Date.now() + 60000, answerId: 'demo-answer', answerText,
    evidence: [{ id: 'e1', start: 0, end: answerText.length, excerpt: answerText }] }, [rubric]);
  const result = await run('demo-call', { rubricId: rubric.id, rubricVersion: rubric.version,
    criterionScores: rubric.criteria.map((c, i) => ({ criterionId: c.id, score: i === 0 ? 4 : 2, evidenceIds: ['e1'] })) });
  console.log(JSON.stringify({ mode: 'offline-arithmetic-fixture', roleId: rubric.roleId, result }, null, 2));
}
