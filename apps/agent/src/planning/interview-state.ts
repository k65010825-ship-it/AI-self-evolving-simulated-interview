import { z } from 'zod';
import { CreateInterviewStateSchema, InterviewStateSchema, SkillObservationSchema,
  type InterviewState, type SkillObservation } from '../../../../packages/contracts/src/interview-state.ts';
import type { ErrorCode } from '../../../../packages/contracts/src/tools.ts';
import { rankSkills } from '../../../../packages/interview-domain/src/planning.ts';
import {PlanningPolicySchema} from '../../../../packages/contracts/src/policy.ts';

export class AgentStateError extends Error {
  constructor(readonly code: ErrorCode) { super(code); this.name = 'AgentStateError'; }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AgentStateError('VALIDATION_ERROR');
  return result.data;
}
function clock(state: InterviewState, now: number) {
  if (!Number.isSafeInteger(now) || now < state.startedAt || state.observations.some((item) => item.observedAt > now))
    throw new AgentStateError('VALIDATION_ERROR');
}

/** The host supplies authorized role/skills and time; none of this is a model-editable tool. */
export function createInterviewState(input: unknown, now: number): InterviewState {
  const config = parse(CreateInterviewStateSchema, input);
  if (!Number.isSafeInteger(now) || now < 0) throw new AgentStateError('VALIDATION_ERROR');
  return parse(InterviewStateSchema, { schemaVersion: 1, sessionId: config.sessionId, roleId: config.roleId,
    version: 0, startedAt: now, deadlineAt: now + config.durationMinutes * 60000, skills: config.skills,
    observations: [], currentSkillId: null, followupDepth: 0, difficulty: 2 });
}

export function recordObservation(rawState: unknown, rawObservation: unknown, expectedVersion: number, now: number): InterviewState {
  const state = parse(InterviewStateSchema, rawState);
  const item = parse(SkillObservationSchema, rawObservation);
  clock(state, now);
  if (item.roleId !== state.roleId) throw new AgentStateError('ROLE_FORBIDDEN');
  if (!state.skills.some((skill) => skill.skillId === item.skillId) || item.observedAt < state.startedAt || item.observedAt > now
    || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new AgentStateError('VALIDATION_ERROR');
  const existing = state.observations.find((observation) => observation.observationId === item.observationId);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(item)) throw new AgentStateError('VERSION_CONFLICT');
    return state; // Same observation retry does not consume a new turn or version.
  }
  if (state.version !== expectedVersion) throw new AgentStateError('VERSION_CONFLICT');
  if (now >= state.deadlineAt) throw new AgentStateError('DEADLINE_EXCEEDED');
  const latest = state.observations.at(-1);
  // Late scoring cannot rewrite which skill/depth is currently being interviewed.
  // Exact idempotent replays were handled above and remain valid after newer observations.
  if (latest && item.observedAt < latest.observedAt) throw new AgentStateError('VERSION_CONFLICT');
  if (state.observations.some((observation) => observation.questionId === item.questionId && observation.skillId !== item.skillId))
    throw new AgentStateError('VALIDATION_ERROR');
  return parse(InterviewStateSchema, { ...state, version: state.version + 1,
    observations: [...state.observations, item], currentSkillId: item.skillId,
    followupDepth: state.currentSkillId === item.skillId ? state.followupDepth + 1 : 0, difficulty: item.difficulty });
}

/** Estimates are derived from evidence, so clocks/summaries cannot drift from a second stored truth. */
export function estimateSkills(rawState: unknown, now: number) {
  const state = parse(InterviewStateSchema, rawState); clock(state, now);
  return state.skills.map((skill) => {
    const independent = new Map<string, SkillObservation>();
    for (const item of [...state.priorEvidence,...state.observations]) if (item.skillId === skill.skillId && !independent.has(item.questionId))
      independent.set(item.questionId, item);
    const evidence = [...independent.values()];
    if (!evidence.length) return { ...skill, mastery: null, confidence: 0, covered: false, independentQuestions: 0 };
    const quality = evidence.reduce((sum, item) => sum + item.quality, 0);
    const mastery = evidence.reduce((sum, item) => sum + item.score * item.quality, 0) / quality;
    const scores = evidence.map((item) => item.score);
    const consistency = 1 - (Math.max(...scores) - Math.min(...scores));
    const coverage = Math.min(1, new Set(evidence.map((item) => item.questionType)).size / 2);
    const latest = Math.max(...evidence.map((item) => item.observedAt));
    const recency = Math.pow(0.5, (now - latest) / (7 * 86400000));
    const confidence = Math.min(1, evidence.length / 3) * coverage * consistency * (quality / evidence.length) * recency;
    return { ...skill, mastery, confidence, covered: state.observations.some(o=>o.skillId===skill.skillId), independentQuestions: evidence.length };
  });
}

export interface NextAction {
  action: 'deepen' | 'switch_skill' | 'adjust_difficulty' | 'finish';
  skillId: string | null; difficulty: number; remainingSeconds: number; reason: string;
}

export function decideNextAction(rawState: unknown, now: number, rawPolicy: unknown = {}): NextAction {
  const state = parse(InterviewStateSchema, rawState); clock(state, now);
  const policy = parse(PlanningPolicySchema, rawPolicy);
  const remainingSeconds = Math.max(0, Math.floor((state.deadlineAt - now) / 1000));
  const finish = (reason: string): NextAction => ({ action: 'finish', skillId: null, difficulty: state.difficulty, remainingSeconds, reason });
  if (remainingSeconds <= policy.wrapUpSeconds) return finish('time_budget');
  if (state.observations.length >= policy.maxTurns) return finish('turn_budget');
  const estimates = estimateSkills(state, now).filter((skill) => skill.relevance > 0
    && !(skill.skillId === state.currentSkillId && state.followupDepth >= policy.maxFollowupDepth));
  const chosen = rankSkills(estimates, remainingSeconds)[0];
  if (!chosen) return finish('no_eligible_skill');
  if (chosen.skillId !== state.currentSkillId) return { action: 'switch_skill', skillId: chosen.skillId,
    difficulty: state.difficulty, remainingSeconds, reason: 'priority_from_cumulative_state' };
  if (chosen.mastery !== null && chosen.mastery < 0.4 && state.difficulty > 1)
    return { action: 'adjust_difficulty', skillId: chosen.skillId, difficulty: state.difficulty - 1, remainingSeconds, reason: 'weak_skill' };
  return { action: 'deepen', skillId: chosen.skillId, difficulty: state.difficulty, remainingSeconds,
    reason: 'clarify_current_skill_evidence' };
}
