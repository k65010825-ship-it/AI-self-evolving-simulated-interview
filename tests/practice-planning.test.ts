import { test, expect } from 'bun:test';
import { createMemory } from '../apps/agent/src/memory/session-memory.ts';
import { buildPracticeGoals } from '../apps/agent/src/learning/practice-plan.ts';
test('memory weakness becomes a traceable next-session goal while unknown remains diagnostic', () => {
  const now=10000,identity={userId:'u',roleId:'java-backend'};
  const base=createMemory(identity,now);
  const memory={...base,version:1,sessions:[{sessionId:'past',stateVersion:1,endedAt:9999,acceptedAt:now,policyVersion:'p',evidenceMode:'offline-fixture',observations:[{
    sessionId:'past',observationId:'o',roleId:'java-backend',skillId:'weak',questionId:'old-q',questionType:'technical',difficulty:2,
    score:.1,quality:1,observedAt:9998,rubricId:'r',rubricVersion:'1',evidenceMode:'offline-fixture'}]}]};
  const request={...identity,now:now+1,session:{sessionId:'next',roleId:'java-backend',durationMinutes:20,skills:[{skillId:'weak',relevance:1},{skillId:'new',relevance:.3}]}};
  const original=JSON.stringify(memory),result=buildPracticeGoals(memory,request);
  expect(result.goals[0]?.skillId).toBe('weak');expect(result.goals[0]?.reason).toBe('weak_evidence');
  expect(result.goals.find(g=>g.skillId==='new')?.mastery).toBeNull();
  expect(result.excludedQuestionIds).toContain('old-q');expect(result.memoryVersion).toBe(1);expect(JSON.stringify(memory)).toBe(original);
  expect(()=>buildPracticeGoals(memory,{...request,userId:'other'})).toThrow('FORBIDDEN');
});
