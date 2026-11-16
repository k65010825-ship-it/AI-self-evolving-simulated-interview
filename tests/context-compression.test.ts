import { test, expect } from 'bun:test';
import { buildInterviewContext } from '../apps/agent/src/context/build-context.ts';
import { createInterviewState } from '../apps/agent/src/planning/interview-state.ts';
import java from '../knowledge/java-backend/seed.json' with { type: 'json' };
const now = 1000000;
const state = createInterviewState({ sessionId: 's', roleId: 'java-backend', durationMinutes: 20,
  skills: [{ skillId: 'spring-transactions', relevance: .1 }, { skillId: 'java-concurrency', relevance: 1 }] }, now);
const input = { state, now, goal: '练习', phase: 'scoring', answer: '必须保留的完整回答', knowledge: java };
test('context compresses optional knowledge by skill relevance rather than incoming order', () => {
  const c = buildInterviewContext({...input,phase:'questioning'}, { allowDraftKnowledge: true, maxKnowledgeItems: 1 });
  expect(c.audit.includedKnowledgeIds).toEqual([java[1]!.id]);
  expect(JSON.parse(c.userPrompt).answer.text).toBe(input.answer);
  expect(c.audit.knowledgeDecisions.some(d => d.reason === 'item_limit')).toBe(true);
});
test('history recall is projected only during questioning, while scoring remains blind to individual old scores', () => {
  const prior = Array.from({length:100},(_,i)=>({sessionId:'private-old',observationId:`o-${i}`,roleId:'java-backend',skillId:'java-concurrency',
    questionId:`q-${i}`,questionType:'technical',difficulty:1,score:.2,quality:1,observedAt:now-1000+i,rubricId:'r',rubricVersion:'1',evidenceMode:'offline-fixture'}));
  const enriched={...state,priorEvidence:prior};
  const q=buildInterviewContext({...input,state:enriched,phase:'questioning'}),s=buildInterviewContext({...input,state:enriched});
  expect(JSON.parse(q.userPrompt).memory).toHaveLength(2);
  expect(q.userPrompt).not.toContain('private-old'); expect(JSON.parse(s.userPrompt).memory).toHaveLength(0);
  expect(s.audit.memory.decisions.length).toBeLessThanOrEqual(6); expect(s.audit.memory.omittedDecisionCount).toBeGreaterThan(0);
  expect(enriched.priorEvidence).toHaveLength(100);
});
test('optional snippets shrink into remaining budget, preserving valid Unicode and measured JSON size', () => {
  const knowledge = [{ ...java[1]!, question: '😀'.repeat(1500) }];
  const c = buildInterviewContext({ ...input,phase:'questioning', knowledge }, { allowDraftKnowledge: true, maxCharacters: 2200, minKnowledgeCharacters: 20 });
  const text = JSON.parse(c.userPrompt).knowledge[0]?.text;
  expect(text).toBeDefined(); expect(text.isWellFormed()).toBe(true);
  expect(c.audit.characterCount).toBeLessThanOrEqual(2200);
  expect(c.audit.compaction.savedCharacters).toBeGreaterThan(0);
});
