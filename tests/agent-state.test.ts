import { describe, expect, test } from 'bun:test';
import { createInterviewState, estimateSkills, recordObservation, decideNextAction } from '../apps/agent/src/planning/interview-state.ts';
const start = 1000000;
const init = () => createInterviewState({ sessionId: 'session-test', roleId: 'java-backend',
  durationMinutes: 20, skills: [{ skillId: 'transactions', relevance: 1 }, { skillId: 'concurrency', relevance: 1 }] }, start);
const evidence = (id: string, overrides: Record<string, unknown> = {}) => ({
  observationId: id, roleId: 'java-backend', skillId: 'transactions', questionId: id,
  questionType: 'scenario', difficulty: 2, score: 0.5, quality: 1, observedAt: start + 1000, ...overrides,
});

describe('current-session evidence state', () => {
  test('unknown mastery stays null instead of a zero score', () => {
    const estimate = estimateSkills(init(), start)[0]!;
    expect(estimate.mastery).toBeNull(); expect(estimate.confidence).toBe(0);
  });
  test('updates weighted mastery without mutating the previous snapshot', () => {
    const original = init();
    const first = recordObservation(original, evidence('q1', { score: 1 }), 0, start + 1000);
    const second = recordObservation(first, evidence('q2', { score: 0, quality: 0.5, questionType: 'technical' }), 1, start + 1000);
    expect(estimateSkills(second, start + 1000)[0]!.mastery).toBeCloseTo(2 / 3);
    expect(original.observations).toHaveLength(0); expect(second.version).toBe(2);
  });
  test('repeating a question does not create independent mastery evidence', () => {
    const first = recordObservation(init(), evidence('obs1', { questionId: 'same-q', score: 0.2 }), 0, start + 1000);
    const second = recordObservation(first, evidence('obs2', { questionId: 'same-q', score: 1 }), 1, start + 1000);
    const estimate = estimateSkills(second, start + 1000)[0]!;
    expect(estimate.independentQuestions).toBe(1); expect(estimate.mastery).toBeCloseTo(0.2);
  });
  test('replaying identical evidence is idempotent, conflicting content and stale new writes fail', () => {
    const observation = evidence('obs1');
    const first = recordObservation(init(), observation, 0, start + 1000);
    expect(recordObservation(first, observation, 0, start + 1000)).toEqual(first);
    expect(() => recordObservation(first, { ...observation, score: 1 }, 0, start + 1000)).toThrow('VERSION_CONFLICT');
    expect(() => recordObservation(first, evidence('obs2'), 0, start + 1000)).toThrow('VERSION_CONFLICT');
  });
  test('rejects cross-role, unknown skill, future evidence and invalid scores', () => {
    for (const [override, code] of [[{ roleId: 'web-frontend' }, 'ROLE_FORBIDDEN'], [{ skillId: 'other' }, 'VALIDATION_ERROR'],
      [{ observedAt: start + 2000 }, 'VALIDATION_ERROR'], [{ score: 2 }, 'VALIDATION_ERROR']] as const) {
      expect(() => recordObservation(init(), evidence('q', override), 0, start + 1000)).toThrow(code);
    }
  });
  test('diverse consistent independent evidence raises confidence, conflict lowers it', () => {
    let stable = init();
    for (let i = 0; i < 3; i++) stable = recordObservation(stable, evidence(`s${i}`, { score: 0.8,
      questionType: i ? 'technical' : 'scenario' }), i, start + 1000);
    expect(estimateSkills(stable, start + 1000)[0]!.confidence).toBeCloseTo(1);
    const conflicting = recordObservation(stable, evidence('conflict', { score: 0 }), 3, start + 1000);
    expect(estimateSkills(conflicting, start + 1000)[0]!.confidence).toBeLessThan(0.3);
  });
  test('late new evidence cannot reset the current skill or bypass maximum follow-up depth', () => {
    let state = init();
    for (let i = 0; i < 3; i++) state = recordObservation(state, evidence(`a${i}`, {
      observedAt: start + 1000 * (i + 1) }), i, start + 3000);
    expect(state.followupDepth).toBe(2);
    expect(() => recordObservation(state, evidence('late-b', { skillId: 'concurrency', observedAt: start + 1500 }),
      3, start + 3000)).toThrow('VERSION_CONFLICT');
    expect(state.currentSkillId).toBe('transactions'); expect(state.followupDepth).toBe(2);
  });
  test('restored snapshots reject reversed chronology', () => {
    const first = recordObservation(init(), evidence('first', { observedAt: start + 2000 }), 0, start + 2000);
    const invalid = { ...first, observations: [...first.observations, evidence('late', { observedAt: start + 1000 })] };
    expect(() => estimateSkills(invalid, start + 3000)).toThrow('VALIDATION_ERROR');
  });
  test('restored snapshots reject one question assigned to different skills', () => {
    const first = recordObservation(init(), evidence('first', { questionId: 'q' }), 0, start + 1000);
    const invalid = { ...first, observations: [...first.observations,
      evidence('other', { questionId: 'q', skillId: 'concurrency' })] };
    expect(() => estimateSkills(invalid, start + 1000)).toThrow('VALIDATION_ERROR');
  });
  test('deadline blocks new writes but does not duplicate a previously accepted observation', () => {
    const observation = evidence('accepted');
    const first = recordObservation(init(), observation, 0, start + 1000);
    expect(() => recordObservation(first, evidence('new'), 1, first.deadlineAt)).toThrow('DEADLINE_EXCEEDED');
    expect(recordObservation(first, observation, 0, first.deadlineAt).version).toBe(1);
  });
  test('a clock before accepted evidence is rejected', () => {
    const first = recordObservation(init(), evidence('first'), 0, start + 1000);
    expect(() => decideNextAction(first, start)).toThrow('VALIDATION_ERROR');
  });
});

describe('state-aware constrained next action', () => {
  test('identical last evidence with different prior history changes the chosen skill', () => {
    let left = recordObservation(init(), evidence('concurrency-low', { skillId: 'concurrency', score: 0.1 }), 0, start + 1000);
    let right = init();
    for (let i = 0; i < 3; i++) right = recordObservation(right, evidence(`good${i}`, { skillId: 'concurrency', score: 0.9,
      questionType: i ? 'technical' : 'scenario' }), i, start + 1000);
    left = recordObservation(left, evidence('last'), left.version, start + 1000);
    right = recordObservation(right, evidence('last'), right.version, start + 1000);
    expect(decideNextAction(left, start + 1000).skillId).toBe('concurrency');
    expect(decideNextAction(right, start + 1000).skillId).toBe('transactions');
  });
  test('reserved wrap-up time finishes even when skills are still uncertain', () => {
    const state = init();
    expect(decideNextAction(state, state.deadlineAt - 10000).action).toBe('finish');
  });
  test('maximum depth switches away from the current skill', () => {
    let state = createInterviewState({ sessionId: 's', roleId: 'java-backend', durationMinutes: 20,
      skills: [{ skillId: 'transactions', relevance: 1 }, { skillId: 'other', relevance: 0.01 }] }, start);
    for (let i = 0; i < 3; i++) state = recordObservation(state, evidence(`depth${i}`, { score: i % 2 }), i, start + 1000);
    const decision = decideNextAction(state, start + 1000);
    expect(decision.action).toBe('switch_skill'); expect(decision.skillId).toBe('other');
  });
  test('a weak current skill lowers difficulty within the allowed range', () => {
    const state = recordObservation(createInterviewState({ sessionId: 's', roleId: 'java-backend', durationMinutes: 20,
      skills: [{ skillId: 'transactions', relevance: 1 }] }, start), evidence('low', { score: 0.1, difficulty: 3 }), 0, start + 1000);
    expect(decideNextAction(state, start + 1000)).toMatchObject({ action: 'adjust_difficulty', difficulty: 2 });
  });
  test('the configured turn budget ends a session before its time budget', () => {
    const state = recordObservation(init(), evidence('one-turn'), 0, start + 1000);
    expect(decideNextAction(state, start + 1000, { maxTurns: 1 }).reason).toBe('turn_budget');
  });
});
