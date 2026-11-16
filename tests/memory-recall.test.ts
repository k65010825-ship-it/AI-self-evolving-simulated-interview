import { test, expect } from 'bun:test';
import { recallMemory } from '../apps/agent/src/memory/recall.ts';
import { createMemory, restoreMemory } from '../apps/agent/src/memory/session-memory.ts';
import { runMemoryDemo } from '../scripts/demo-agent-memory.ts';
const now = 20 * 86400000;
function memory() {
  const m = createMemory({ userId: 'student', roleId: 'java-backend' }, now);
  const observations = ['a', 'a', 'b', 'b'].map((skillId, i) => ({ sessionId: 'old', observationId: `o-${i}`, roleId: 'java-backend', skillId,
    questionId: `q-${i}`, questionType: 'technical', difficulty: 1, score: i / 4, quality: 1, observedAt: now - 1000 + i,
    rubricId: 'r', rubricVersion: '1', evidenceMode: 'offline-fixture' }));
  return { ...m, version: 1, sessions: [{ sessionId: 'old', stateVersion: 4, endedAt: now - 1, acceptedAt: now, policyVersion: 'p', evidenceMode: 'offline-fixture', observations }] };
}
const request = { userId: 'student', roleId: 'java-backend', now, skillIds: ['a', 'b'], policy: { maxItems: 2, maxPerSkill: 2, maxAgeDays: 7 } };
test('both-role SDK histories survive JSON recovery and feed recall with unchanged provenance', async () => {
  for(const roleId of ['java-backend','web-frontend'] as const){
    const demo=await runMemoryDemo(roleId),identity={userId:'demo',roleId};
    const restored=restoreMemory(JSON.stringify(demo.memory),identity),source=restored.sessions.flatMap(s=>s.observations);
    const r=recallMemory(restored,{...identity,now:restored.updatedAt+1,skillIds:[...new Set(source.map(e=>e.skillId))]});
    expect(r.selected.length).toBeGreaterThan(0);expect(r.selected.every(e=>source.some(o=>JSON.stringify(o)===JSON.stringify(e)))).toBe(true);
    expect(r.selected.every(e=>e.evidenceMode==='offline-fixture')).toBe(true);expect(demo.liveModelCalls).toBe(0);
  }
});
test('bounded recall balances skills and preserves original evidence without mutating stored memory', () => {
  const m = memory(), original = JSON.stringify(m), result = recallMemory(m, request);
  expect(result.selected.map(o => o.skillId)).toEqual(['a', 'b']);
  expect(result.selected.map(o => o.questionId)).toEqual(['q-1', 'q-3']);
  expect(result.askedQuestionIds).toHaveLength(4); expect(JSON.stringify(m)).toBe(original);
});
test('identity and original evidence age are enforced; stale history still remembers asked IDs', () => {
  expect(() => recallMemory(memory(), { ...request, userId: 'other' })).toThrow('FORBIDDEN');
  expect(() => recallMemory(memory(), { ...request, roleId: 'web-frontend' })).toThrow('ROLE_FORBIDDEN');
  const old = memory(); old.sessions[0]!.observations.forEach(o => { o.observedAt = 1; });
  const r = recallMemory(old, request); expect(r.selected).toHaveLength(0); expect(r.askedQuestionIds).toHaveLength(4);
  expect(r.excluded.every(e => e.reason === 'age')).toBe(true);
});
test('repeated old question cannot refresh its timestamp through a newer observation', () => {
  const m=memory(); m.sessions[0]!.observations[0]!.observedAt=1;
  m.sessions[0]!.observations[1]!.questionId='q-0';
  const r=recallMemory(m,request);
  expect(r.selected.some(e=>e.questionId==='q-0')).toBe(false);
  expect(r.excluded.some(e=>e.reason==='duplicate')).toBe(true);
  expect(r.askedQuestionIds).toContain('q-0');
});
