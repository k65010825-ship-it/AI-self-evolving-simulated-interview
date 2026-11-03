import { z } from 'zod';
import { RubricSchema, ScoringInputSchema, ScoringContextSchema, ScoringReceiptSchema,
  type ScoringReceipt } from '../../../../packages/contracts/src/scoring.ts';
import { describeError } from '../../../../packages/contracts/src/errors.ts';
import type { ErrorCode } from '../../../../packages/contracts/src/tools.ts';
import { AgentStateError } from '../planning/interview-state.ts';

export function createScoringExecutor(rawContext: unknown, rawRubrics: unknown, rawOptions: unknown = {}) {
  const host = ScoringContextSchema.safeParse(rawContext), rubrics = z.array(RubricSchema).min(1).max(100).safeParse(rawRubrics);
  const options = z.object({ maxCalls: z.number().int().min(0).max(100).default(5) }).strict().safeParse(rawOptions);
  if (!host.success || !rubrics.success || !options.success) throw new AgentStateError('VALIDATION_ERROR');
  if (new Set(rubrics.data.map(r => `${r.id}:${r.version}`)).size !== rubrics.data.length)
    throw new AgentStateError('VALIDATION_ERROR');
  const context = host.data, definitions = rubrics.data; let calls = 0;
  return async (callId: string, rawInput: unknown, signal?: AbortSignal, now: () => number = Date.now): Promise<ScoringReceipt> => {
    const started = performance.now();
    const fail = (code: ErrorCode): ScoringReceipt => {
      const { message, retryable } = describeError(code);
      return ScoringReceiptSchema.parse({ callId, toolName: 'compute_rubric_score', status: 'error',
        durationMs: performance.now() - started, error: { code, message, retryable } });
    };
    if (signal?.aborted) return fail('RUN_CANCELLED');
    if (now() >= context.deadlineAt) return fail('DEADLINE_EXCEEDED');
    const parsed = ScoringInputSchema.safeParse(rawInput);
    if (!parsed.success) return fail('VALIDATION_ERROR');
    const input = parsed.data;
    const candidates = definitions.filter(r => r.id === input.rubricId);
    if (!candidates.length) return fail('NOT_FOUND');
    if (!candidates.some(r => r.roleId === context.roleId)) return fail('ROLE_FORBIDDEN');
    const rubric = candidates.find(r => r.roleId === context.roleId && r.version === input.rubricVersion);
    if (!rubric) return fail('VERSION_CONFLICT');
    if (calls >= options.data.maxCalls) return fail('TOOL_BUDGET_EXCEEDED');
    calls++; // Semantic failures also consume an attempt after authorized rubric lookup.
    if (input.criterionScores.some(s => !rubric.criteria.some(c => c.id === s.criterionId))) return fail('VALIDATION_ERROR');
    const dimensions = [];
    let weighted = 0, coverageWeight = 0;
    for (const criterion of rubric.criteria) {
      const assessment = input.criterionScores.find(s => s.criterionId === criterion.id);
      const score = assessment?.score ?? null;
      if ((criterion.required && score === null) || (score !== null && (score > criterion.maxScore
        || !assessment?.evidenceIds.length)) || assessment?.evidenceIds.some(id => !context.evidence.some(e => e.id === id)))
        return fail('VALIDATION_ERROR');
      const normalizedScore = score === null ? null : score / criterion.maxScore;
      if (normalizedScore !== null) { weighted += normalizedScore * criterion.weight; coverageWeight += criterion.weight; }
      dimensions.push({ criterionId: criterion.id, score, normalizedScore, evidenceIds: assessment?.evidenceIds ?? [] });
    }
    const missingDimensions = dimensions.filter(d => d.score === null).map(d => d.criterionId);
    return ScoringReceiptSchema.parse({ callId, toolName: 'compute_rubric_score', status: coverageWeight ? 'ok' : 'insufficient_evidence',
      durationMs: performance.now() - started, data: { answerId: context.answerId, rubricId: rubric.id, rubricVersion: rubric.version,
        scope: rubric.scope, normalizedScore: coverageWeight ? Math.min(1, weighted / coverageWeight) : null,
        coverageWeight: Math.min(1, coverageWeight), complete: missingDimensions.length === 0, missingDimensions, dimensions } });
  };
}
