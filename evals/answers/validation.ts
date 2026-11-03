import { createHash } from 'node:crypto';
import { EvaluationOutputSchema } from '../../packages/contracts/src/evaluation.ts';
import { ScoringContextSchema, RubricSchema } from '../../packages/contracts/src/scoring.ts';
import { z } from 'zod';
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
}
export const contentHash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
const assessmentSchema = EvaluationOutputSchema.pick({ evidence: true, criterionScores: true });
/** Literal support/range validation, not semantic evidence review. Benchmark criteria may abstain. */
export function validateBenchmarkAssessment(raw: unknown, rubric: z.infer<typeof RubricSchema>, answer: string) {
  const p = assessmentSchema.safeParse(raw);
  if (!p.success) throw new Error('ANSWER_ASSESSMENT_INVALID');
  const a = p.data;
  const evidence = ScoringContextSchema.safeParse({ userId: 'benchmark', runId: 'benchmark', attemptId: 'a', roleId: rubric.roleId,
    deadlineAt: 1, answerId: 'benchmark', answerText: answer, evidence: a.evidence });
  if (!evidence.success || a.criterionScores.length !== rubric.criteria.length) throw new Error('ANSWER_ASSESSMENT_INVALID');
  for (const c of rubric.criteria) {
    const score = a.criterionScores.find(s => s.criterionId === c.id);
    if (!score || new Set(score.evidenceIds).size !== score.evidenceIds.length || (score.score !== null && (score.score > c.maxScore || !score.evidenceIds.length)) ||
      (score.score === null && score.evidenceIds.length !== 0) || score.evidenceIds.some(id => !a.evidence.some(e => e.id === id))) throw new Error('ANSWER_ASSESSMENT_INVALID');
  }
  return a;
}
