import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ScoringContextSchema, type InterviewWorkflow, type WorkflowOperation, type WorkflowCommitErrorCode } from '@interview/contracts';

export class WorkflowCommitError extends Error { constructor(readonly code: WorkflowCommitErrorCode) { super(code); this.name = 'WorkflowCommitError'; } }
export function reject(code: WorkflowCommitErrorCode): never { throw new WorkflowCommitError(code); }
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
export function normalizedText(value: unknown) {
  let text: string | undefined;
  try { text = JSON.stringify(value); } catch { reject('COMMIT_VALIDATION_ERROR'); }
  if (typeof text !== 'string' || text.length > 32 * 1024 * 1024) reject('COMMIT_VALIDATION_ERROR');
  return canonical(JSON.parse(text));
}
export const equal = (a: unknown, b: unknown) => normalizedText(a) === normalizedText(b);
export const workflowCommitDigest = (value: unknown) => createHash('sha256').update(normalizedText(value)).digest('hex');
export function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  const p = schema.safeParse(value); if (!p.success) reject('COMMIT_VALIDATION_ERROR'); return p.data;
}
function requireEqual(a: unknown, b: unknown) { if (!equal(a, b)) reject('COMMIT_TRANSITION_INVALID'); }
function unchanged(before: InterviewWorkflow, after: InterviewWorkflow, allowed: string[]) {
  const omit = (s: InterviewWorkflow) => Object.fromEntries(Object.entries(s).filter(([key]) => !allowed.includes(key)));
  requireEqual(omit(before), omit(after));
}
function scoreChecks(turn: InterviewWorkflow['turns'][number]) {
  const { input, proposal } = turn, result = proposal.evaluation;
  decode(ScoringContextSchema, { ...input.context, answerId: input.answer.id, answerText: input.answer.text, evidence: proposal.evidence });
  if (result.answerId !== input.answer.id || result.rubricId !== input.rubric.id || result.rubricVersion !== input.rubric.version || result.scope !== input.rubric.scope ||
    !result.complete || result.missingDimensions.length || Math.abs(result.coverageWeight - 1) > 1e-9 || result.dimensions.length !== input.rubric.criteria.length ||
    new Set(result.dimensions.map(d => d.criterionId)).size !== result.dimensions.length) reject('COMMIT_TRANSITION_INVALID');
  let weighted = 0;
  for (const c of input.rubric.criteria) {
    const d = result.dimensions.find(d => d.criterionId === c.id);
    if (!d || d.score === null || d.score > c.maxScore || d.normalizedScore === null || Math.abs(d.normalizedScore - d.score / c.maxScore) > 1e-9 ||
      !d.evidenceIds.length || new Set(d.evidenceIds).size !== d.evidenceIds.length || d.evidenceIds.some(id => !proposal.evidence.some(e => e.id === id))) reject('COMMIT_TRANSITION_INVALID');
    weighted += d.normalizedScore * c.weight;
  }
  if (result.normalizedScore === null || Math.abs(result.normalizedScore - weighted) > 1e-9) reject('COMMIT_TRANSITION_INVALID');
}
/** Continuity/binding validation only; not model, planner, report or reflection algorithm replay. */
export function validateWorkflowTransition(op: WorkflowOperation, after: InterviewWorkflow, now: number) {
  if (op.action === 'create') {
    const c = op.config;
    if (!c.memory) reject('COMMIT_TRANSITION_INVALID'); // API must explicitly supply its persisted/bootstrap profile.
    const priorEvidence = c.memory.sessions.flatMap(s => s.observations).filter(o => c.session.skills.some(s => s.skillId === o.skillId))
      .sort((a, b) => a.observedAt - b.observedAt || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
    requireEqual(after, { kind: 'uncommitted-interview-session', revision: 0, identity: c.identity,
      state: { schemaVersion: 1, sessionId: c.session.sessionId, roleId: c.session.roleId, version: 0, startedAt: c.now,
        deadlineAt: c.now + c.session.durationMinutes * 60000, skills: c.session.skills, observations: [], currentSkillId: null, followupDepth: 0, difficulty: 2, priorEvidence },
      policy: c.policy, goal: c.goal, skillLabels: c.skillLabels, baseMemory: c.memory, allowDraftKnowledge: c.allowDraftKnowledge,
      phase: 'ready_to_plan', turns: [], askedQuestionIds: [], issuedQuestions: [], current: null, currentIssuedAt: null, lastPlan: null, pendingReason: null, closeout: null });
    return;
  }
  const before = op.snapshot;
  if (op.action === 'restore') { requireEqual(after, before); return; }
  const command = op.command;
  if (op.action === 'finish' && before.phase === 'completed') {
    if (![before.revision, before.closeout!.requestRevision].includes(op.command.expectedRevision) || op.command.sourceGroupId !== before.closeout!.sourceGroupId || op.command.mode !== before.closeout!.requestMode) reject('COMMIT_TRANSITION_INVALID');
    requireEqual(after, before); return;
  }
  if (command.expectedRevision !== before.revision || after.revision !== before.revision + 1) reject('COMMIT_TRANSITION_INVALID');
  if (op.action === 'plan') {
    if (before.phase !== 'ready_to_plan' || !after.lastPlan) reject('COMMIT_TRANSITION_INVALID');
    unchanged(before, after, ['revision', 'lastPlan', 'current', 'currentIssuedAt', 'askedQuestionIds', 'issuedQuestions', 'phase', 'pendingReason']);
    const selection = after.lastPlan.selection;
    if (selection.status === 'selected') {
      if (after.phase !== 'awaiting_answer' || after.currentIssuedAt === null || after.currentIssuedAt > now || after.pendingReason !== null ||
        selection.question.roleId !== before.identity.roleId || selection.rubric.roleId !== before.identity.roleId || selection.plan.action === 'finish' ||
        selection.plan.skillId !== selection.question.skillId || !before.state.skills.some(s => s.skillId === selection.question.skillId) ||
        after.currentIssuedAt >= before.state.deadlineAt || after.currentIssuedAt < (before.state.observations.at(-1)?.observedAt ?? before.state.startedAt) ||
        before.askedQuestionIds.includes(selection.question.id) || (!before.allowDraftKnowledge && selection.source.reviewStatus === 'draft')) reject('COMMIT_TRANSITION_INVALID');
      const records = after.lastPlan.receipts.flatMap(r => {
        if (r.status === 'error' || !r.data || r.data.items.some(i => i.roleId !== before.identity.roleId)) reject('COMMIT_TRANSITION_INVALID');
        return r.data.items;
      }).filter(i => i.id === selection.question.id);
      const item = records[0];
      if (!item || records.some(i => !equal(i, item))) reject('COMMIT_TRANSITION_INVALID');
      requireEqual(selection.question, { id: item.id, roleId: item.roleId, skillId: item.skillId, text: item.question, questionType: item.questionType, difficulty: item.difficulty });
      requireEqual(selection.source, { knowledgeId: item.id, version: item.version, sourceIds: item.sourceIds, reviewStatus: item.reviewStatus });
      requireEqual(selection.rubric, { id: item.id, version: item.version, roleId: item.roleId, scope: item.questionType === 'behavioral' ? 'behavioral-content' : 'technical-content',
        criteria: item.rubric.map(c => ({ id: c.criterionId, maxScore: c.maxScore, weight: c.weight, required: true, description: c.description,
          ...(c.dimension ? { dimension: c.dimension } : {}), ...(c.evidenceRule ? { evidenceRule: c.evidenceRule } : {}), ...(c.anchors ? { anchors: c.anchors } : {}) })) });
      requireEqual(after.current, selection);
      requireEqual(after.askedQuestionIds, [...before.askedQuestionIds, selection.question.id]);
      requireEqual(after.issuedQuestions, [...before.issuedQuestions, { questionId: selection.question.id, issuedAt: after.currentIssuedAt }]);
    } else {
      if (after.phase !== 'ready_to_close' || after.current !== null || after.currentIssuedAt !== null || after.pendingReason !== (selection.status === 'finished' ? 'plan_finished' : 'knowledge_gap')) reject('COMMIT_TRANSITION_INVALID');
      requireEqual(after.askedQuestionIds, before.askedQuestionIds); requireEqual(after.issuedQuestions, before.issuedQuestions);
    }
    return;
  }
  if (op.action === 'answer') {
    if (before.phase !== 'awaiting_answer' || !before.current || after.turns.length !== before.turns.length + 1) reject('COMMIT_TRANSITION_INVALID');
    unchanged(before, after, ['revision', 'state', 'turns', 'current', 'currentIssuedAt', 'phase', 'pendingReason']);
    requireEqual(after.turns.slice(0, -1), before.turns);
    const turn = after.turns.at(-1)!, c = op.command;
    requireEqual(turn.input, { state: before.state, expectedVersion: before.state.version, observationId: c.observationId, goal: before.goal, context: c.context,
      question: before.current.question, answer: c.answer, quality: c.quality, rubric: before.current.rubric, knowledge: [], planningPolicy: before.policy, ...(c.speech ? { speech: c.speech } : {}) });
    if (turn.evidenceMode !== c.evidenceMode) reject('COMMIT_TRANSITION_INVALID');
    requireEqual(turn.proposal.basedOn, { sessionId: before.state.sessionId, sessionVersion: before.state.version, runId: c.context.runId, attemptId: c.context.attemptId,
      answerId: c.answer.id, questionId: before.current.question.id });
    scoreChecks(turn);
    const observation = after.state.observations.at(-1)!;
    if (observation.observedAt < before.currentIssuedAt! || observation.observedAt > now) reject('COMMIT_TRANSITION_INVALID');
    requireEqual(observation, { observationId: c.observationId, roleId: before.identity.roleId, skillId: before.current.question.skillId,
      questionId: before.current.question.id, questionType: before.current.question.questionType, difficulty: before.current.question.difficulty,
      score: turn.proposal.evaluation.normalizedScore, quality: c.quality, observedAt: observation.observedAt });
    requireEqual(after.state, { ...before.state, version: before.state.version + 1, observations: [...before.state.observations, observation],
      currentSkillId: observation.skillId, followupDepth: before.state.currentSkillId === observation.skillId ? before.state.followupDepth + 1 : 0, difficulty: observation.difficulty });
    const finished = turn.proposal.nextAction.action === 'finish';
    if (after.current !== null || after.currentIssuedAt !== null || after.phase !== (finished ? 'ready_to_close' : 'ready_to_plan') || after.pendingReason !== (finished ? 'plan_finished' : null)) reject('COMMIT_TRANSITION_INVALID');
    return;
  }
  unchanged(before, after, ['revision', 'phase', 'current', 'currentIssuedAt', 'pendingReason', 'closeout']);
  const close = after.closeout, c = op.command;
  if (!close || after.phase !== 'completed' || after.current !== null || after.currentIssuedAt !== null || close.generatedAt > now ||
    close.requestRevision !== c.expectedRevision || close.requestMode !== c.mode || close.sourceGroupId !== c.sourceGroupId ||
    after.pendingReason !== close.reason || close.reason !== (c.mode === 'user_stop' ? 'user_stop' : before.pendingReason) || (c.mode === 'automatic' && before.phase !== 'ready_to_close')) reject('COMMIT_TRANSITION_INVALID');
  const report = close.report;
  const modes = new Set([...before.turns.map(t => t.evidenceMode), ...before.state.priorEvidence.map(o => o.evidenceMode)]);
  const evidenceMode = modes.size === 0 || modes.has('unverified') ? 'unverified' : modes.size > 1 ? 'mixed' : [...modes][0]!;
  const scopes = new Set([...before.turns.map(t => t.input.rubric.scope), ...before.state.priorEvidence.map(o => o.questionType === 'behavioral' ? 'behavioral-content' as const : 'technical-content' as const)]);
  const scope = scopes.size > 1 ? 'mixed-content' : [...scopes][0] ?? 'technical-content';
  if (report.roleId !== before.identity.roleId || report.generatedAt !== close.generatedAt || report.policyVersion !== before.policy.id ||
    report.evidenceMode !== evidenceMode || close.reflection.evidenceMode !== evidenceMode || report.scope !== scope ||
    report.assessments.length !== before.turns.length || report.coverage.totalAnswers !== before.turns.length || close.reflection.roleId !== before.identity.roleId ||
    close.reflection.sourceGroupId !== c.sourceGroupId || close.reflection.generatedAt !== close.generatedAt) reject('COMMIT_TRANSITION_INVALID');
  const reflected = close.reflection.candidate;
  if (reflected && (reflected.roleId !== before.identity.roleId || reflected.baselineId !== before.policy.id || reflected.sourceSessionId !== before.state.sessionId ||
    reflected.sourceGroupId !== c.sourceGroupId || reflected.createdAt !== close.generatedAt || reflected.evidenceMode !== evidenceMode)) reject('COMMIT_TRANSITION_INVALID');
  const speech = before.turns.flatMap(t => {
    if (!t.input.speech) return [];
    const s = t.input.speech, transcript = s.transcription;
    return [{ answerId: t.input.answer.id, questionId: t.input.question.id, transcriptionId: transcript.transcriptionId,
      audio: transcript.audio, mode: transcript.mode, provider: transcript.provider, confirmedAt: s.confirmedAt,
      originalText: transcript.originalText, confirmedText: s.answer.text, features: s.expression, warnings: s.warnings }];
  });
  if (speech.length) {
    if (report.expression.status !== 'audio_descriptions') reject('COMMIT_TRANSITION_INVALID');
    const modes = new Set(speech.map(s => s.mode));
    if (report.expression.speechEvidenceMode !== (modes.size > 1 ? 'mixed' : [...modes][0])) reject('COMMIT_TRANSITION_INVALID');
    requireEqual(report.expression.answers, speech);
  } else if (report.expression.status !== 'not_evaluated') reject('COMMIT_TRANSITION_INVALID');
  const expectedAssessments = before.turns.map(t => ({ observationId: t.input.observationId, answerId: t.input.answer.id, questionId: t.input.question.id,
    skillId: t.input.question.skillId, questionType: t.input.question.questionType, questionText: t.input.question.text, difficulty: t.input.question.difficulty,
    rubricId: t.input.rubric.id, rubricVersion: t.input.rubric.version, rubric: t.input.rubric, evaluation: t.proposal.evaluation,
    evidence: t.proposal.evidence, feedback: t.proposal.feedback, evidenceMode: t.evidenceMode }));
  requireEqual(report.assessments, expectedAssessments);
  if (!before.turns.length) {
    if (close.memoryDisposition !== 'unchanged_no_answers') reject('COMMIT_TRANSITION_INVALID');
    requireEqual(close.memoryCandidate, before.baseMemory);
  } else {
    if (close.memoryDisposition !== 'appended' || close.generatedAt < before.baseMemory.updatedAt) reject('COMMIT_TRANSITION_INVALID');
    const session = { sessionId: before.state.sessionId, stateVersion: before.state.version, endedAt: close.generatedAt, acceptedAt: close.generatedAt,
      policyVersion: report.policyVersion, evidenceMode, observations: before.state.observations.map(o => {
        const t = before.turns.find(t => t.input.observationId === o.observationId)!;
        return { ...o, sessionId: before.state.sessionId, rubricId: t.input.rubric.id, rubricVersion: t.input.rubric.version, evidenceMode: t.evidenceMode };
      }) };
    const sessions = [...before.baseMemory.sessions, session].sort((a, b) => a.endedAt - b.endedAt || (a.sessionId < b.sessionId ? -1 : 1));
    requireEqual(close.memoryCandidate, { ...before.baseMemory, version: before.baseMemory.version + 1, updatedAt: close.generatedAt, sessions });
  }
}
