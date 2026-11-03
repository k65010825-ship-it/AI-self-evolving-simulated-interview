import { z } from 'zod';
import { EvaluationOutputSchema } from '../../packages/contracts/src/evaluation.ts';
import type { AnswerRow } from '../../packages/contracts/src/answer-benchmark.ts';
import type { KnowledgeWorkspace } from '../../packages/contracts/src/knowledge-curation.ts';
import { AgentStateError } from '../../apps/agent/src/planning/interview-state.ts';
import { createInterviewState } from '../../apps/agent/src/planning/interview-state.ts';
import { buildInterviewContext } from '../../apps/agent/src/context/build-context.ts';
import { createPiEvaluator } from '../../apps/agent/src/adapters/pi/evaluator.ts';
import type { EvaluationRequest } from '../../apps/agent/src/orchestration/evaluate-turn.ts';
import { createEvaluationFixture } from '../../experiments/pi-sdk/evaluation-fixture.ts';
import { compileAnswerDataset, getBenchmarkKnowledge, loadAnswerBundle } from './dataset.ts';
import { benchmarkSamples, sealAnswerReport } from './metrics.ts';
import { contentHash, validateBenchmarkAssessment } from './validation.ts';

type Evaluate = (request: EvaluationRequest, signal: AbortSignal) => Promise<unknown>;
const optionsSchema = z.object({ split: z.enum(['development', 'validation', 'reserved-final']), evaluatorId: z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
  timeoutMs: z.number().int().min(1).max(60000).default(10000) }).strict();
export async function runAnswerBenchmark(rawBundle: unknown, knowledge: KnowledgeWorkspace, input: {
  split: 'development' | 'validation'; evaluatorId: string; timeoutMs?: number; evaluate: Evaluate; signal?: AbortSignal;
}) {
  const { evaluate, signal, ...options } = input, parsed = optionsSchema.safeParse(options);
  if (!parsed.success || typeof evaluate !== 'function') throw new Error('ANSWER_BENCHMARK_INVALID');
  const config = parsed.data;
  if (config.split === 'reserved-final') throw new Error('ANSWER_SPLIT_FORBIDDEN');
  const dataset = compileAnswerDataset(structuredClone(rawBundle), structuredClone(knowledge)), samples = benchmarkSamples(dataset, config.split);
  const startedAt = new Date().toISOString(), rows: AnswerRow[] = [];
  for (const sample of samples) {
    const identity = { caseId: sample.case.id, roleId: sample.question.roleId, questionId: sample.question.id, rubricVersion: sample.rubric.version };
    if (signal?.aborted) { rows.push({ ...identity, status: 'cancelled', error: 'RUN_CANCELLED' }); continue; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, onAbort: (() => void) | undefined;
    try {
      const deadline = performance.now() + config.timeoutMs;
      const check = () => {
        if (signal?.aborted) throw new AgentStateError('RUN_CANCELLED');
        if (controller.signal.aborted || performance.now() >= deadline) throw new AgentStateError('DEADLINE_EXCEEDED');
      };
      const now = Date.now(), state = createInterviewState({ sessionId: 'benchmark-session', roleId: sample.question.roleId,
        skills: [{ skillId: sample.question.skillId, relevance: 1 }], durationMinutes: 20 }, now);
      // This is the entire inference boundary: no sample IDs, variants, splits, guides or references.
      const request: EvaluationRequest = { outputSchemaVersion: 1, context: buildInterviewContext({ state, now, goal: '评估当前回答内容',
        phase: 'scoring', answer: sample.case.answer, knowledge: [] }),
        question: { text: sample.question.text, skillId: sample.question.skillId, questionType: sample.question.questionType, difficulty: sample.question.difficulty },
        rubric: structuredClone(sample.rubric) };
      const stop = new Promise<never>((_resolve, reject) => {
        onAbort = () => { controller.abort(); reject(new AgentStateError('RUN_CANCELLED')); };
        signal?.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => { controller.abort(); reject(new AgentStateError('DEADLINE_EXCEEDED')); }, config.timeoutMs);
        if (signal?.aborted) onAbort();
      });
      const raw = await Promise.race([stop, Promise.resolve().then(() => {
        check();
        return evaluate(structuredClone(request), controller.signal);
      })]);
      check();
      const output = EvaluationOutputSchema.safeParse(raw);
      if (!output.success) throw new AgentStateError('MODEL_OUTPUT_INVALID');
      let assessed;
      try { assessed = validateBenchmarkAssessment({ evidence: output.data.evidence, criterionScores: output.data.criterionScores }, sample.rubric, sample.case.answer); }
      catch { throw new AgentStateError('MODEL_OUTPUT_INVALID'); }
      check();
      rows.push({ ...identity, status: 'completed', scores: assessed.criterionScores.map(c => ({ criterionId: c.criterionId, score: c.score })), assessmentDigest: contentHash(output.data) });
    } catch (e) {
      const code = e instanceof AgentStateError ? e.code : 'DEPENDENCY_UNAVAILABLE';
      rows.push({ ...identity, status: code === 'RUN_CANCELLED' ? 'cancelled' : code === 'DEADLINE_EXCEEDED' ? 'timed_out' : 'failed', error: code });
    } finally { if (timer) clearTimeout(timer); if (onAbort) signal?.removeEventListener('abort', onAbort); }
  }
  return sealAnswerReport(dataset, { split: config.split, rows, evaluatorId: config.evaluatorId, startedAt, finishedAt: new Date().toISOString() });
}

/** Actual Pi SDK, local provider with no reference access; deliberately gives every criterion half marks. */
export async function runOfflineAnswerBenchmark(split: 'development' | 'validation' = 'development', observe?: (request: EvaluationRequest) => void) {
  const fixture = await createEvaluationFixture(context => {
    const last = context.messages.filter(m => m.role === 'user').at(-1)!;
    const text = typeof last.content === 'string' ? last.content : last.content.filter(c => c.type === 'text').map(c => c.text).join('');
    const request = JSON.parse(text) as { interview: { answer: { text: string } }; rubric: { criteria: { id: string; maxScore: number }[] } };
    const answer = request.interview.answer.text;
    return { text: JSON.stringify({ evidence: [{ id: 'e1', start: 0, end: answer.length, excerpt: answer }],
      criterionScores: request.rubric.criteria.map(c => ({ criterionId: c.id, score: c.maxScore / 2, evidenceIds: ['e1'] })),
      feedback: { strengths: ['本地替身固定输出，不判断语义'], improvements: ['需要独立人工参考与真实模型验证'] } }) };
  });
  const evaluators = new Map((['java-backend', 'web-frontend'] as const).map(roleId => [roleId,
    createPiEvaluator({ cwd: process.cwd(), modelRuntime: fixture.runtime, model: fixture.model, roleId })]));
  return runAnswerBenchmark(loadAnswerBundle(), getBenchmarkKnowledge(), { split, evaluatorId: 'half-score-offline-fixture', evaluate: async (request, signal) => {
    // Observers receive a copy too; they cannot mutate the private request or labels.
    observe?.(structuredClone(request));
    return evaluators.get(request.rubric.roleId)!(request, signal);
  } });
}
