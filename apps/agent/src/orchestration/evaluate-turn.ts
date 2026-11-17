import { z } from 'zod';
import { TurnInputSchema, EvaluationOutputSchema, TurnProposalSchema,
  type TurnProposal } from '../../../../packages/contracts/src/evaluation.ts';
import { buildInterviewContext } from '../context/build-context.ts';
import { AgentStateError, recordObservation, decideNextAction } from '../planning/interview-state.ts';
import { createScoringExecutor } from '../tools/scoring-executor.ts';
import { validateSpeechForTurn } from '../speech/validate-answer.ts';
import { validateContentScope } from './validate-content-scope.ts';
import type { TurnInput } from '../../../../packages/contracts/src/evaluation.ts';
import type { ScoringResultSchema } from '../../../../packages/contracts/src/scoring.ts';
import {ScoringContextSchema}from'../../../../packages/contracts/src/scoring.ts';
import type {EvaluationDiagnosticSink,ScoringRejection}from'../../../../packages/contracts/src/evaluation-diagnostic.ts';
import type {BindingInvalidDetail,BindingSpanConflict} from '../../../../packages/contracts/src/verification-binding.ts';
import {diagnose}from'../evaluation/diagnostic.ts';
import {evidenceFailureReason}from'../evaluation/evidence-diagnostic.ts';
import {isExplicitNonAnswer,type EvidenceSupportRejection}from'../../../../packages/interview-domain/src/evidence-support.ts';
export interface ValidatedInsufficientTurn{kind:'validated-insufficient-score';input:TurnInput;score:z.infer<typeof ScoringResultSchema>;at:number;}

export interface EvaluationRequest {
  outputSchemaVersion: 1;
  context: Pick<ReturnType<typeof buildInterviewContext>,'promptVersion'|'systemPrompt'|'userPrompt'>;
  question: { text: string; skillId: string; questionType: string; difficulty: number };
  rubric: z.infer<typeof TurnInputSchema>['rubric'];
}
export interface EvaluationDependencies {
  evaluate: (request: EvaluationRequest, signal: AbortSignal) => Promise<unknown>;
  now?: () => number;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRequestCharacters?: number;
  onDiagnostic?:EvaluationDiagnosticSink;
}
const OptionsSchema = z.object({ timeoutMs: z.number().int().min(1).max(60000).default(10000),
  maxRequestCharacters: z.number().int().min(1).max(100000).default(16000) });

/** Produces a proposal only. API must independently check ownership, attempt lease and CAS before commit. */
export async function assessTurn(rawInput: unknown, dependencies: EvaluationDependencies,allowAbstention=false): Promise<TurnProposal|ValidatedInsufficientTurn> {
  const parsed = TurnInputSchema.safeParse(rawInput);
  const config = OptionsSchema.safeParse({ timeoutMs: dependencies.timeoutMs, maxRequestCharacters: dependencies.maxRequestCharacters });
  if (!parsed.success || !config.success || typeof dependencies.evaluate !== 'function') throw new AgentStateError('VALIDATION_ERROR');
  const input = parsed.data, options = config.data, now = dependencies.now ?? Date.now;
  const startedAt = now(), deadlineAt = Math.min(input.context.deadlineAt, input.state.deadlineAt);
  const check = () => {
    if (dependencies.signal?.aborted) throw new AgentStateError('RUN_CANCELLED');
    const current = now();
    if (!Number.isSafeInteger(current) || current < startedAt) throw new AgentStateError('VALIDATION_ERROR');
    if (current >= deadlineAt) throw new AgentStateError('DEADLINE_EXCEEDED');
    return current;
  };
  check();
  if (input.context.roleId !== input.state.roleId || input.question.roleId !== input.state.roleId
    || input.rubric.roleId !== input.state.roleId
    || (input.planningPolicy && input.planningPolicy.roleId !== input.state.roleId)) throw new AgentStateError('ROLE_FORBIDDEN');
  if (!input.state.skills.some(s => s.skillId === input.question.skillId)) throw new AgentStateError('VALIDATION_ERROR');
  if ([...input.state.priorEvidence,...input.state.observations].some(o => o.questionId === input.question.id && o.skillId !== input.question.skillId))
    throw new AgentStateError('VALIDATION_ERROR');
  if (input.expectedVersion !== input.state.version || input.state.observations.some(o => o.observationId === input.observationId))
    throw new AgentStateError('VERSION_CONFLICT');
  validateContentScope(input);
  if(input.speech)validateSpeechForTurn(input.speech,{userId:input.context.userId,roleId:input.context.roleId,
    answer:input.answer,sessionStartedAt:input.state.startedAt,at:startedAt});
  if(isExplicitNonAnswer(input.answer.text)){
    diagnose(dependencies.onDiagnostic,'evidence','rejected','no-substantive-answer');
    if(!allowAbstention)throw new AgentStateError('MODEL_OUTPUT_INVALID');
    const compute=createScoringExecutor({...input.context,deadlineAt,answerId:input.answer.id,answerText:input.answer.text,evidence:[]},[input.rubric],{maxCalls:1,allowRequiredAbstention:true});
    const receipt=await compute(input.observationId,{rubricId:input.rubric.id,rubricVersion:input.rubric.version,
      criterionScores:input.rubric.criteria.map(c=>({criterionId:c.id,score:null,evidenceIds:[]}))},undefined,now);
    const at=check();if(!receipt.data)throw new AgentStateError('MODEL_OUTPUT_INVALID');
    return{kind:'validated-insufficient-score',input,score:receipt.data,at};
  }
  const context = buildInterviewContext({ state: input.state, now: startedAt, goal: input.goal,
    phase: 'scoring', answer: input.answer.text, knowledge: input.knowledge });
  const request: EvaluationRequest = { outputSchemaVersion: 1, context:{promptVersion:context.promptVersion,systemPrompt:context.systemPrompt,userPrompt:context.userPrompt},
    question: { text: input.question.text, skillId: input.question.skillId,
      questionType: input.question.questionType, difficulty: input.question.difficulty }, rubric: input.rubric };
  // Include question/rubric and JSON escaping, not only the base interview prompt.
  if (JSON.stringify(request).length > options.maxRequestCharacters) throw new AgentStateError('CONTEXT_BUDGET_EXCEEDED');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let rawOutput: unknown;
  try {
    const stop = new Promise<never>((_resolve, reject) => {
      onAbort = () => { controller.abort(); reject(new AgentStateError('RUN_CANCELLED')); };
      dependencies.signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(new AgentStateError('DEADLINE_EXCEEDED')); },
        Math.min(options.timeoutMs, deadlineAt - check()));
    });
    const evaluation = Promise.resolve().then(() => {
      // An abort can arrive between listener registration and the provider microtask.
      check();
      return dependencies.evaluate(structuredClone(request), controller.signal);
    }).catch((error: unknown) => {
      check();
      if (error instanceof AgentStateError) throw error;
      throw new AgentStateError('DEPENDENCY_UNAVAILABLE');
    });
    rawOutput = await Promise.race([evaluation, stop]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) dependencies.signal?.removeEventListener('abort', onAbort);
  }
  check();
  const assessed = EvaluationOutputSchema.safeParse(rawOutput);
  if (!assessed.success) {diagnose(dependencies.onDiagnostic,'schema','rejected','invalid-schema');throw new AgentStateError('MODEL_OUTPUT_INVALID');}
  if(allowAbstention&&assessed.data.criterionScores.length!==input.rubric.criteria.length){
    diagnose(dependencies.onDiagnostic,'scoring','rejected','score-dimension-set-mismatch');
    diagnose(dependencies.onDiagnostic,'scoring','rejected','invalid-score');throw new AgentStateError('MODEL_OUTPUT_INVALID');}
  const scoringContext={...input.context,deadlineAt,answerId:input.answer.id,answerText:input.answer.text,evidence:assessed.data.evidence};
  if(!ScoringContextSchema.safeParse(scoringContext).success){diagnose(dependencies.onDiagnostic,'evidence','rejected',evidenceFailureReason(input.answer.text,assessed.data.evidence));throw new AgentStateError('MODEL_OUTPUT_INVALID');}
  diagnose(dependencies.onDiagnostic,'evidence','accepted','valid');check();
  let score;
  try {
    const execute = createScoringExecutor(scoringContext, [input.rubric], { maxCalls: 1,allowRequiredAbstention:allowAbstention,
      onScoringRejection:(reason:ScoringRejection,detail?:BindingInvalidDetail,conflict?:BindingSpanConflict)=>diagnose(dependencies.onDiagnostic,'scoring','rejected',reason,undefined,{...(detail?{bindingIssue:detail}:{}),...(conflict?{bindingConflict:conflict}:{})}),
      onEvidenceRejection:(reason:EvidenceSupportRejection)=>diagnose(dependencies.onDiagnostic,'evidence','rejected',reason) });
    // Executor's wall-clock check uses the same host clock (see injected clock option).
    score = await execute(input.observationId, { rubricId: input.rubric.id, rubricVersion: input.rubric.version,
      criterionScores: assessed.data.criterionScores }, controller.signal, now);
  } catch { check();diagnose(dependencies.onDiagnostic,'scoring','rejected','invalid-score');throw new AgentStateError('MODEL_OUTPUT_INVALID'); }
  const completedAt = check();
  if(allowAbstention&&score.status!=='error'&&score.data&&!score.data.complete){
    diagnose(dependencies.onDiagnostic,'scoring','rejected','incomplete-score');check();
    return{kind:'validated-insufficient-score',input,score:score.data,at:completedAt};
  }
  if (score.status !== 'ok' || !score.data?.complete || score.data.normalizedScore === null){
    diagnose(dependencies.onDiagnostic,'scoring','rejected','invalid-score');
    throw new AgentStateError('MODEL_OUTPUT_INVALID');
  }
  diagnose(dependencies.onDiagnostic,'scoring','accepted','valid');check();
  const nextState = recordObservation(input.state, { observationId: input.observationId,
    roleId: input.state.roleId, skillId: input.question.skillId, questionId: input.question.id,
    questionType: input.question.questionType, difficulty: input.question.difficulty,
    ...(input.assistance?{assistance:input.assistance}:{}),score: score.data.normalizedScore, quality: input.quality, observedAt: completedAt }, input.expectedVersion, completedAt);
  return TurnProposalSchema.parse({ kind: 'uncommitted-turn-proposal',
    basedOn: { sessionId: input.state.sessionId, sessionVersion: input.expectedVersion, runId: input.context.runId,
      attemptId: input.context.attemptId, answerId: input.answer.id, questionId: input.question.id },
    evaluation: score.data, evidence: assessed.data.evidence, feedback: assessed.data.feedback,
    nextState, nextAction: decideNextAction(nextState, completedAt,input.planningPolicy?.parameters??{}) });
}
/** Default strict entry point remains compatible with report/workflow replay. */
export async function evaluateTurn(rawInput:unknown,dependencies:EvaluationDependencies):Promise<TurnProposal>{
 const result=await assessTurn(rawInput,dependencies);
 if(result.kind==='validated-insufficient-score')throw new AgentStateError('MODEL_OUTPUT_INVALID');return result;
}
