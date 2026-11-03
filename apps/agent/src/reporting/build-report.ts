import { ReportInputSchema, ContentReportSchema, type ContentReport } from '../../../../packages/contracts/src/report.ts';
import { AgentStateError, estimateSkills, recordObservation } from '../planning/interview-state.ts';
import { createScoringExecutor } from '../tools/scoring-executor.ts';
import { validateSpeechForTurn } from '../speech/validate-answer.ts';
import { validateContentScope } from '../orchestration/validate-content-scope.ts';
import{scopeForQuestionType}from'../../../../packages/contracts/src/rubric-dimensions.ts';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const invalid = (): never => { throw new AgentStateError('VALIDATION_ERROR'); };
/** Rechecks host-supplied records, producing a deterministic draft, never an official report commit. */
export async function buildInterviewReport(rawInput: unknown): Promise<ContentReport> {
  const parsed = ReportInputSchema.safeParse(rawInput);
  if (!parsed.success) return invalid();
  const { state, generatedAt, skillLabels, turns, policyVersion } = parsed.data;
  const estimates = estimateSkills(state, generatedAt);
  if (Object.keys(skillLabels).length !== state.skills.length || state.skills.some(s => !Object.hasOwn(skillLabels, s.skillId))
    || turns.length !== state.observations.length) return invalid();
  if (new Set(turns.map(t => t.input.observationId)).size !== turns.length
    || new Set(turns.map(t => t.input.answer.id)).size !== turns.length) return invalid();
  const assessments: ContentReport['assessments'] = [];
  const versions = new Map<string, string>();
  const speechAnswers:Extract<ContentReport['expression'],{status:'audio_descriptions'}>['answers']=[];
  const transcriptionIds=new Set<string>(),audioIds=new Set<string>();
  const owner = turns[0]?.input.context.userId;
  let previous = undefined as typeof state | undefined;
  for (const [index, observation] of state.observations.entries()) {
    const turn = turns.find(t => t.input.observationId === observation.observationId);
    if (!turn) return invalid();
    const { input, proposal } = turn;
    validateContentScope(input);
    if(input.planningPolicy && (input.planningPolicy.id!==policyVersion || input.planningPolicy.roleId!==state.roleId)) return invalid();
    if ([input.state.roleId, input.context.roleId, input.question.roleId, input.rubric.roleId, proposal.nextState.roleId]
      .some(role => role !== state.roleId) || input.context.userId !== owner) throw new AgentStateError('ROLE_FORBIDDEN');
    if (input.state.sessionId !== state.sessionId || input.state.version !== input.expectedVersion
      || !same(input.state.observations, state.observations.slice(0, index))
      || !same(input.state.skills, state.skills) || input.state.startedAt !== state.startedAt || input.state.deadlineAt !== state.deadlineAt
      || (previous && !same(input.state, previous)) || observation.observedAt >= input.context.deadlineAt
      || !same(proposal.basedOn, { sessionId: state.sessionId, sessionVersion: input.expectedVersion, runId: input.context.runId,
        attemptId: input.context.attemptId, answerId: input.answer.id, questionId: input.question.id })) return invalid();
    if(input.speech){
      const s=validateSpeechForTurn(input.speech,{userId:input.context.userId,roleId:state.roleId,
        answer:input.answer,sessionStartedAt:state.startedAt,at:observation.observedAt});
      const t=s.transcription;
      if(transcriptionIds.has(t.transcriptionId)||audioIds.has(t.audio.audioId))return invalid();
      transcriptionIds.add(t.transcriptionId);audioIds.add(t.audio.audioId);
      speechAnswers.push({answerId:input.answer.id,questionId:input.question.id,transcriptionId:t.transcriptionId,
        audio:t.audio,mode:t.mode,provider:t.provider,confirmedAt:s.confirmedAt,
        originalText:t.originalText,confirmedText:s.answer.text,features:s.expression,warnings:s.warnings});
    }
    const key = JSON.stringify([input.rubric.id, input.rubric.version]);
    const definition = JSON.stringify(input.rubric);
    if (versions.has(key) && versions.get(key) !== definition) return invalid();
    versions.set(key, definition);
    let score;
    try {
      const execute = createScoringExecutor({ ...input.context, answerId: input.answer.id, answerText: input.answer.text,
        evidence: proposal.evidence }, [input.rubric], { maxCalls: 1 });
      // Replay arithmetic at the original observation time; no new model inference or expired-run submission.
      score = await execute(observation.observationId, { rubricId: input.rubric.id, rubricVersion: input.rubric.version,
        criterionScores: proposal.evaluation.dimensions.map(d => ({ criterionId: d.criterionId, score: d.score, evidenceIds: d.evidenceIds })) },
        undefined, () => observation.observedAt);
    } catch { return invalid(); }
    if (score.status !== 'ok' || !score.data?.complete || score.data.normalizedScore === null
      || !same(score.data, proposal.evaluation)) return invalid();
    let replay;
    try {
      replay = recordObservation(input.state, { observationId: input.observationId, roleId: state.roleId,
        skillId: input.question.skillId, questionId: input.question.id, questionType: input.question.questionType,
        difficulty: input.question.difficulty, score: score.data.normalizedScore, quality: input.quality,
        observedAt: observation.observedAt }, input.expectedVersion, observation.observedAt);
    } catch { return invalid(); }
    if (!same(replay, proposal.nextState) || !same(replay.observations.at(-1), observation)) return invalid();
    previous = replay;
    assessments.push({ observationId: observation.observationId, answerId: input.answer.id, questionId: input.question.id,
      skillId: input.question.skillId, questionType:input.question.questionType,questionText: input.question.text, difficulty: input.question.difficulty,
      rubricId: input.rubric.id, rubricVersion: input.rubric.version, rubric: input.rubric, evaluation: score.data,
      evidence: proposal.evidence, feedback: proposal.feedback, evidenceMode: turn.evidenceMode });
  }
  if (previous && !same(previous, state)) return invalid();
  const modes = new Set([...turns.map(t => t.evidenceMode),...state.priorEvidence.map(o=>o.evidenceMode)]);
  const evidenceMode = modes.size === 0 || modes.has('unverified') ? 'unverified'
    : modes.size > 1 ? 'mixed' : [...modes][0]!;
  const warnings = [speechAnswers.length?'technical_content_scores_only_no_overall_score':'content_only_no_overall_score',
    'semantic_grading_not_verified_by_report', 'resources_not_integrated'];
  if (evidenceMode !== 'live-model') warnings.push('contains_non_live_or_unverified_evidence');
  if(speechAnswers.length)warnings.push('audio_timing_descriptions_not_expression_scores');
  if(speechAnswers.some(s=>s.mode==='offline-fixture'))warnings.push('contains_offline_speech');
  const scopes=new Set([...assessments.map(a=>a.rubric.scope),...state.priorEvidence.map(o=>scopeForQuestionType(o.questionType))]);
  const scope=scopes.size>1?'mixed-content':([...scopes][0]??'technical-content');
  if(scope!=='technical-content'){
    warnings[0]='per_rubric_content_scores_no_overall_score';
    warnings.push('behavioral_narrative_not_verified_experience');
  }
  if(assessments.some(a=>a.rubric.criteria.some(c=>c.dimension)))warnings.push('dimension_ratings_not_independently_calibrated');
  if(state.priorEvidence.length) warnings.push('includes_prior_session_evidence','independent_coverage_includes_history');
  const skills = estimates.map(s => {
    const unique = new Map([...state.priorEvidence,...assessments].filter(a => a.skillId === s.skillId).map(a =>
      [JSON.stringify([a.rubricId, a.rubricVersion]), { id: a.rubricId, version: a.rubricVersion }]));
    if (unique.size > 1) warnings.push(`mixed_rubrics:${s.skillId}`);
    return { skillId: s.skillId, label: skillLabels[s.skillId]!, mastery: s.mastery, confidence: s.confidence,
      independentQuestions: s.independentQuestions, rubricVersions: [...unique.values()] };
  });
  const reason = (s: typeof skills[number]) => s.mastery === null ? 'assess_unknown' as const
    : s.mastery < 0.6 ? 'repair_gap' as const : 'verify_uncertainty' as const;
  const order = { repair_gap: 0, assess_unknown: 1, verify_uncertainty: 2 };
  const candidates = skills.filter(s => s.mastery === null || s.mastery < 0.6 || s.confidence < 0.5)
    .sort((a,b) => order[reason(a)] - order[reason(b)] || (a.mastery ?? 0.5) - (b.mastery ?? 0.5)
      || (a.skillId < b.skillId ? -1 : 1));
  const studyPlan = candidates.slice(0, 3).map(s => {
    const supporting = assessments.filter(a => a.skillId === s.skillId);
    const actions = [...new Set(supporting.flatMap(a => a.feedback.improvements))].slice(0, 3);
    return { skillId: s.skillId, label: s.label, reason: reason(s), minutes: s.mastery === null ? 15 : 25,
      actions: actions.length ? actions : [`用自己的话解释${s.label}的关键概念，再完成一个具体场景练习。`],
      evidenceAnswerIds: supporting.map(a => a.answerId), retest: { requireDifferentQuestion: true as const,
        excludeQuestionIds: [...new Set(supporting.map(a => a.questionId))],
        successCriteria: '同技能不同题中说明关键条件、失败场景与方案取舍；保留回答证据后再评价，不承诺提分。' } };
  });
  return ContentReportSchema.parse({ schemaVersion: 1, kind: 'uncommitted-content-report', sessionId: state.sessionId,
    sessionVersion: state.version, roleId: state.roleId, generatedAt, policyVersion, evidenceMode, scope,
    coverage: { totalSkills: skills.length, observedSkills: skills.filter(s => state.observations.some(o=>o.skillId===s.skillId)).length,
      totalAnswers: assessments.length, independentQuestions: skills.reduce((sum,s) => sum + s.independentQuestions, 0) },
    skills, assessments, studyPlan, expression: speechAnswers.length?{
      status:'audio_descriptions',scope:'audio-timing-only',
      speechEvidenceMode:new Set(speechAnswers.map(s=>s.mode)).size>1?'mixed':speechAnswers[0]!.mode,
      coverage:{totalAnswers:assessments.length,speechAnswers:speechAnswers.length,textAnswers:assessments.length-speechAnswers.length,
        descriptiveAnswers:speechAnswers.filter(s=>s.features.status==='descriptive').length,
        insufficientAnswers:speechAnswers.filter(s=>s.features.status==='insufficient_data').length},
      answers:speechAnswers,speechRate:null,clarity:null,confidence:null,emotion:null,
    }:{status:'not_evaluated',reason:'no_confirmed_audio',speechRate:null,clarity:null,confidence:null},
    resourceRecommendations: [], warnings });
}
