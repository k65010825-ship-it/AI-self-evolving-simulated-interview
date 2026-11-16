import { z } from 'zod';
import { QuestionSelectionInputSchema, QuestionSelectionSchema, type QuestionSelection } from '../../../../packages/contracts/src/question-selection.ts';
import { AgentStateError, decideNextAction } from './interview-state.ts';
/** Input knowledge and issued IDs are host-owned; output is not a committed issued question. */
export function selectNextQuestion(rawInput: unknown, rawOptions: unknown = {}): QuestionSelection {
  const parsed = QuestionSelectionInputSchema.safeParse(rawInput);
  const config = z.object({ allowDraftKnowledge: z.boolean().default(false) }).strict().safeParse(rawOptions);
  if (!parsed.success || !config.success) throw new AgentStateError('VALIDATION_ERROR');
  const input = parsed.data;
  if (input.knowledge.some(k => k.roleId !== input.state.roleId)) throw new AgentStateError('ROLE_FORBIDDEN');
  if(input.planningPolicy&&input.planningPolicy.roleId!==input.state.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
  if (new Set(input.knowledge.map(k => k.id)).size !== input.knowledge.length) throw new AgentStateError('VALIDATION_ERROR');
  const plan = decideNextAction(input.state, input.now,input.planningPolicy?.parameters??{});
  if (plan.action === 'finish') return { status: 'finished', plan };
  const asked = new Set([...input.askedQuestionIds, ...input.state.priorEvidence.map(o=>o.questionId), ...input.state.observations.map(o => o.questionId)]);
  const constructs=new Map([...input.state.priorEvidence,...input.state.observations].map(o=>[o.skillId,o.questionType==='behavioral']));
  const candidates = input.knowledge.filter(k => k.skillId === plan.skillId && !asked.has(k.id)
    && (!constructs.has(k.skillId)||constructs.get(k.skillId)===(k.questionType==='behavioral'))
    && (k.reviewStatus === 'reviewed' || config.data.allowDraftKnowledge));
  candidates.sort((a, b) => Math.abs(a.difficulty - plan.difficulty) - Math.abs(b.difficulty - plan.difficulty)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const selected = candidates[0];
  if (!selected) return { status: 'unavailable', plan, reason: 'no_eligible_question' };
  const result = QuestionSelectionSchema.safeParse({ status: 'selected', plan,
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
