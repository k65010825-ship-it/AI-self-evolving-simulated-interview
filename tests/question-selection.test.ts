import { expect, test } from 'bun:test';
import java from '../knowledge/java-backend/seed.json' with { type: 'json' };
import web from '../knowledge/web-frontend/seed.json' with { type: 'json' };
import { createInterviewState, recordObservation } from '../apps/agent/src/planning/interview-state.ts';
import { selectNextQuestion } from '../apps/agent/src/planning/select-question.ts';
const now = 1000000;
const state = createInterviewState({ sessionId: 'selection', roleId: 'java-backend', durationMinutes: 20,
  skills: [{ skillId: 'spring-transactions', relevance: 1 }, { skillId: 'java-concurrency', relevance: 0.9 }] }, now);
const input = { state, now, knowledge: java, askedQuestionIds: [] };
test('draft is excluded by default, explicitly enabled only for development', () => {
  expect(selectNextQuestion(input).status).toBe('unavailable');
  const result = selectNextQuestion(input, { allowDraftKnowledge: true });
  expect(result.status).toBe('selected');
  if (result.status !== 'selected') throw new Error('Expected selected question');
  expect(result.question.skillId).toBe('spring-transactions');
  expect(result.source.sourceIds).toEqual(['spring-transactions']);
  expect(result.rubric.criteria[0]?.description).toContain('边界');
  expect(JSON.stringify(result.question)).not.toContain('keyPoints');
  expect(JSON.stringify(result.question)).not.toContain('rubric');
});
test('chooses nearest difficulty deterministically without changing actual question difficulty', () => {
  const base = java[0]!;
  const result = selectNextQuestion({ ...input, knowledge: [{ ...base, id: 'z', difficulty: 3 },
    { ...base, id: 'a', difficulty: 1 }] }, { allowDraftKnowledge: true });
  if (result.status !== 'selected') throw new Error('Expected selected question');
  expect(result.question.id).toBe('a'); expect(result.question.difficulty).toBe(1);
});
test('excludes both issued questions and previously observed questions', () => {
  expect(selectNextQuestion({ ...input, askedQuestionIds: [java[0]!.id] }, { allowDraftKnowledge: true }).status).toBe('unavailable');
  const observed = recordObservation(state, { observationId: 'o', roleId: state.roleId, skillId: 'spring-transactions',
    questionId: java[0]!.id, questionType: 'scenario', difficulty: 3, score: 0.9, quality: 1, observedAt: now }, 0, now);
  const result = selectNextQuestion({ ...input, state: observed }, { allowDraftKnowledge: true });
  if (result.status !== 'selected') throw new Error('Expected selected question');
  expect(result.question.id).toBe(java[1]!.id);
});
test('rejects cross-role candidates, duplicate IDs and unknown host fields', () => {
  expect(() => selectNextQuestion({ ...input, knowledge: [web[0]] })).toThrow('ROLE_FORBIDDEN');
  expect(() => selectNextQuestion({ ...input, knowledge: [java[0], java[0]] })).toThrow('VALIDATION_ERROR');
  expect(() => selectNextQuestion({ ...input, admin: true })).toThrow('VALIDATION_ERROR');
});
test('returns finish without selecting a question at wrapup', () => {
  const result = selectNextQuestion({ ...input, now: state.deadlineAt - 10000 }, { allowDraftKnowledge: true });
  expect(result.status).toBe('finished'); expect('question' in result).toBe(false);
});
test('does not silently switch the planned skill when its knowledge is missing', () => {
  const result = selectNextQuestion({ ...input, knowledge: [java[1]] }, { allowDraftKnowledge: true });
  expect(result.status).toBe('unavailable'); expect(result.plan.skillId).toBe('spring-transactions');
});
test('reviewed content works by default; behavioral selection has a distinct content scope', () => {
  const reviewed = { ...java[0]!, reviewStatus: 'reviewed' };
  expect(selectNextQuestion({ ...input, knowledge: [reviewed] }).status).toBe('selected');
  const behavioral=selectNextQuestion({ ...input, knowledge: [{ ...reviewed, questionType: 'behavioral' }] });
  expect(behavioral.status).toBe('selected');if(behavioral.status==='selected')expect(behavioral.rubric.scope).toBe('behavioral-content');
});
