import { z } from 'zod';
import { CreateInterviewStateSchema, InterviewStateSchema, SkillObservationSchema,
  type InterviewState, type SkillObservation } from '../../contracts/src/interview-state.ts';
import type { ErrorCode } from '../../contracts/src/tools.ts';

import {PlanningPolicySchema} from '../../contracts/src/policy.ts';
import {historyEligibility}from'./history-compatibility.ts';
import type {KnowledgeCatalogPin} from '../../contracts/src/knowledge-catalog.ts';
import {eligibleQuestions,validCatalogPin,validPinnedReceipts} from './question-eligibility.ts';
import type {PlannerInput,PlannerResult} from '../../contracts/src/knowledge-planner.ts';

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
    observations: [], currentSkillId: null, followupDepth: 0, difficulty: 2,
    ...(config.historyCompatibility?{historyCompatibility:config.historyCompatibility}:{}) });
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
  const history=historyEligibility(state.priorEvidence,state.historyCompatibility),eligible=history.eligibleQuestionIds;
  const historyQuestions=new Set(state.priorEvidence.map(e=>e.questionId));
  return state.skills.map((skill) => {
    const independent = new Map<string, SkillObservation>();
    for (const item of [...history.anchors.values(),...state.observations]) if (item.skillId === skill.skillId && !independent.has(item.questionId))
      independent.set(item.questionId, item);
    // First establish question independence from the full history, then gate its original anchor.
    const evidence = [...independent.values()].filter(e=>!e.assistance&&(!historyQuestions.has(e.questionId)||eligible.has(e.questionId)));
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
  const chosen = rankForPolicy(estimates, remainingSeconds, policy.practiceMode)[0];
  if (!chosen) return finish('no_eligible_skill');
  if (chosen.skillId !== state.currentSkillId) return { action: 'switch_skill', skillId: chosen.skillId,
    difficulty: state.difficulty, remainingSeconds, reason: 'priority_from_cumulative_state' };
  if (chosen.mastery !== null && chosen.mastery < 0.4 && state.difficulty > 1)
    return { action: 'adjust_difficulty', skillId: chosen.skillId, difficulty: state.difficulty - 1, remainingSeconds, reason: 'weak_skill' };
  // Opt-in policy keeps already-committed plans replayable. A high average from easier,
  // historical or repeated answers must not repeatedly staircase the current difficulty.
  if (policy.difficultyProgression && chosen.mastery !== null && chosen.mastery >= 0.8
    && chosen.confidence >= 0.6 && remainingSeconds >= 180 && state.difficulty < 5) {
    const priorIds = new Set(state.priorEvidence.map(o => o.questionId));
    const independent = new Map<string, SkillObservation>();
    for (const o of state.observations) if (o.skillId === chosen.skillId && !priorIds.has(o.questionId) && !independent.has(o.questionId))
      independent.set(o.questionId, o);
    const recent = [...independent.values()].slice(-2);
    if (recent.length === 2 && new Set(recent.map(o => o.questionType)).size === 2
      && recent.every(o => !o.assistance && o.score >= 0.8 && o.quality >= 0.8 && o.difficulty >= state.difficulty))
      return { action: 'adjust_difficulty', skillId: chosen.skillId, difficulty: state.difficulty + 1, remainingSeconds, reason: 'strong_independent_evidence' };
  }
  return { action: 'deepen', skillId: chosen.skillId, difficulty: state.difficulty, remainingSeconds,
    reason: 'clarify_current_skill_evidence' };
}

/** Resolve availability once, before opening Pi; intent planning remains unchanged. */
export function resolveQuestionPlan(state:InterviewState,now:number,rawPolicy:unknown,askedQuestionIds:readonly string[],catalogPin?:KnowledgeCatalogPin,allowDraftKnowledge=false){
 const policy=parse(PlanningPolicySchema,rawPolicy),intent=decideNextAction(state,now,policy);
 if(!policy.questionFallback)return{plan:intent};
 if(!catalogPin||catalogPin.roleId!==state.roleId||!validCatalogPin(catalogPin))throw new AgentStateError('VALIDATION_ERROR');
 const provenance={version:'catalog-unseen-v1' as const,catalogId:catalogPin.id,catalogDigest:catalogPin.digest,decidedAt:now,intent};
 const candidates=eligibleQuestions(catalogPin.items,{roleId:state.roleId,skillIds:state.skills.filter(s=>s.relevance>0).map(s=>s.skillId),
  askedQuestionIds,priorEvidence:state.priorEvidence,observations:state.observations,allowDraftKnowledge,targetDifficulty:intent.difficulty});
 if(intent.action==='finish'||candidates.some(q=>q.skillId===intent.skillId)||!candidates.length)return{plan:intent,provenance};
 const available=new Set(candidates.map(q=>q.skillId)),ranked=rankForPolicy(estimateSkills(state,now).filter(s=>s.relevance>0&&available.has(s.skillId)
  &&!(s.skillId===state.currentSkillId&&state.followupDepth>=policy.maxFollowupDepth)),intent.remainingSeconds,policy.practiceMode);
 const next=ranked[0];
 const plan:NextAction=next?{...intent,action:'switch_skill',skillId:next.skillId,reason:'planned_skill_depleted_fallback'}:
  {...intent,action:'finish',skillId:null,reason:'no_eligible_skill'};
 return{plan,provenance};
}

export interface SkillEstimate {
  skillId: string; relevance: number; mastery: number | null; confidence: number; covered: boolean;
}
function rankForPolicy(skills: readonly SkillEstimate[], remainingSeconds: number, practiceMode?: 'weakness-focus' | 'broad-coverage') {
  const ranked = rankSkills(skills, remainingSeconds);
  if (practiceMode !== 'broad-coverage') return ranked;
  return [...ranked].sort((a, b) => Number(a.covered) - Number(b.covered));
}
/** Candidate ranking only; the full state-aware Agent planner is a later iteration. */
export function rankSkills(skills: readonly SkillEstimate[], remainingSeconds: number) {
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) return [];
  return skills.map((skill) => {
    for (const value of [skill.relevance, skill.confidence, skill.mastery ?? 0.5]) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Skill estimates must be within [0, 1].');
    }
    return { ...skill, priority: 0.45 * skill.relevance * (1 - skill.confidence)
      + 0.35 * skill.relevance * (1 - (skill.mastery ?? 0.5)) + 0.2 * (skill.covered ? 0 : 1) };
  }).sort((a, b) => b.priority - a.priority || a.skillId.localeCompare(b.skillId));
}


import { QuestionSelectionInputSchema, QuestionSelectionSchema, type QuestionSelection } from '../../contracts/src/question-selection.ts';


/** Input knowledge and issued IDs are host-owned; output is not a committed issued question. */
export function selectNextQuestion(rawInput: unknown, rawOptions: unknown = {}): QuestionSelection {
  const parsed = QuestionSelectionInputSchema.safeParse(rawInput);
  const config = z.object({ allowDraftKnowledge: z.boolean().default(false) }).strict().safeParse(rawOptions);
  if (!parsed.success || !config.success) throw new AgentStateError('VALIDATION_ERROR');
  const input = parsed.data;
  if (input.knowledge.some(k => k.roleId !== input.state.roleId)) throw new AgentStateError('ROLE_FORBIDDEN');
  if(input.planningPolicy&&input.planningPolicy.roleId!==input.state.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
  if (new Set(input.knowledge.map(k => k.id)).size !== input.knowledge.length) throw new AgentStateError('VALIDATION_ERROR');
  const {plan,provenance}=resolveQuestionPlan(input.state,input.now,input.planningPolicy?.parameters??{},input.askedQuestionIds,input.catalogPin,config.data.allowDraftKnowledge);
  const binding=provenance?{provenance}:{};
  if (plan.action === 'finish') return { status: 'finished', plan,...binding };
  const asked = new Set([...input.askedQuestionIds, ...input.state.priorEvidence.map(o=>o.questionId), ...input.state.observations.map(o => o.questionId)]);
  const constructs=new Map([...input.state.priorEvidence,...input.state.observations].map(o=>[o.skillId,o.questionType==='behavioral']));
  const candidates = provenance?eligibleQuestions(input.catalogPin!.items,{roleId:input.state.roleId,skillIds:[plan.skillId!],askedQuestionIds:input.askedQuestionIds,
    priorEvidence:input.state.priorEvidence,observations:input.state.observations,allowDraftKnowledge:config.data.allowDraftKnowledge,targetDifficulty:plan.difficulty}):input.knowledge.filter(k => k.skillId === plan.skillId && !asked.has(k.id)
    && (!constructs.has(k.skillId)||constructs.get(k.skillId)===(k.questionType==='behavioral'))
    && (k.reviewStatus === 'reviewed' || config.data.allowDraftKnowledge));
  candidates.sort((a, b) => Math.abs(a.difficulty - plan.difficulty) - Math.abs(b.difficulty - plan.difficulty)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const selected = candidates[0];
  if (!selected) return { status: 'unavailable', plan,...binding, reason: 'no_eligible_question' };
  if(provenance&&!input.knowledge.some(q=>JSON.stringify(q)===JSON.stringify(selected)))throw new AgentStateError('MODEL_OUTPUT_INVALID');
  const result = QuestionSelectionSchema.safeParse({ status: 'selected', plan,...binding,
    question: { id: selected.id, roleId: selected.roleId, skillId: selected.skillId, text: selected.question,
      questionType: selected.questionType, difficulty: selected.difficulty },
    rubric: { id: selected.id, version: selected.version, roleId: selected.roleId, scope: selected.questionType==='behavioral'?'behavioral-content':'technical-content',
      criteria: selected.rubric.map(c => ({ id: c.criterionId, maxScore: c.maxScore, weight: c.weight,
        required: true, description: c.description,
        ...(c.dimension?{dimension:c.dimension}:{}),...(c.evidenceRule?{evidenceRule:c.evidenceRule}:{}),...(c.anchors?{anchors:c.anchors}:{}),...(c.verificationGoal?{verificationGoal:c.verificationGoal}:{}) })) },
    source: { knowledgeId: selected.id, version: selected.version, sourceIds: selected.sourceIds, reviewStatus: selected.reviewStatus } });
  if (!result.success) throw new AgentStateError('VALIDATION_ERROR');
  return result.data;
}

/** Replayed at workflow/recovery/commit boundaries; no model-declared intent is authoritative. */
export function validatePinnedPlan(input:Pick<PlannerInput,'state'|'planningPolicy'|'askedQuestionIds'|'catalogPin'|'allowDraftKnowledge'>,
 result:PlannerResult,bounds:{now:number;notBefore:number;deadlineAt:number}){
 const selection=result.selection,at=selection.provenance?.decidedAt;
 if(at===undefined||at<bounds.notBefore||at>bounds.now||at>=bounds.deadlineAt)throw new AgentStateError('MODEL_OUTPUT_INVALID');
 const expected=selectNextQuestion({state:input.state,planningPolicy:input.planningPolicy,askedQuestionIds:input.askedQuestionIds,catalogPin:input.catalogPin,now:at,knowledge:result.receipts.flatMap(r=>r.data?.items??[])},
  {allowDraftKnowledge:input.allowDraftKnowledge});
 if(JSON.stringify(QuestionSelectionSchema.parse(expected))!==JSON.stringify(QuestionSelectionSchema.parse(selection)))throw new AgentStateError('MODEL_OUTPUT_INVALID');
 const candidates=eligibleQuestions(input.catalogPin!.items,{roleId:input.state.roleId,skillIds:input.state.skills.filter(s=>s.relevance>0).map(s=>s.skillId),
  askedQuestionIds:input.askedQuestionIds,priorEvidence:input.state.priorEvidence,observations:input.state.observations,
  allowDraftKnowledge:input.allowDraftKnowledge,targetDifficulty:selection.plan.difficulty});
 const scope=selection.plan.skillId??result.receipts.flatMap(r=>r.data?.items??[])[0]?.skillId??null;
 if(!validPinnedReceipts(result.receipts,scope,candidates)||selection.status!=='finished'&&!result.receipts.length&&!(selection.status==='unavailable'&&result.modelMessages===0))throw new AgentStateError('MODEL_OUTPUT_INVALID');
 return expected;
}
