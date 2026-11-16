import { test,expect } from 'bun:test';
import { runPracticePlanningDemo } from '../scripts/demo-practice-planning.ts';
test('both roles execute memory goal, frozen prediction, verified practice, unseen selection and existing pair checks',async()=>{
 for(const role of ['java-backend','web-frontend']as const){const r=await runPracticePlanningDemo(role);
  expect(r.goal.reason).toBe('weak_evidence');expect(r.plan.status).toBe('ready');expect(r.plan.questionId).toBe('practice-unseen-q');
  expect(r.plan.excluded.some(e=>e.questionId==='practice-old-q'&&e.reason==='question_repeated')).toBe(true);
  expect(r.blockedReasons).toContain('learning_not_verified');expect(r.pair.status).toBe('eligible');
  expect(r.liveModelCalls).toBe(0);expect(r.formalCommitted).toBe(false);
 }
});
