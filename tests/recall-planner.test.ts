import { test, expect } from 'bun:test';
import { createPiQuestionPlanner } from '../apps/agent/src/adapters/pi/question-planner.ts';
import { createInterviewState } from '../apps/agent/src/planning/interview-state.ts';
import { createEvaluationFixture } from '../experiments/pi-sdk/evaluation-fixture.ts';
import { contentText, plannerReply } from '../experiments/pi-sdk/planner-fixture.ts';
test('actual offline Pi planner receives bounded cross-session evidence without private session identifiers', async () => {
  const now=Date.now(); let observed=false;
  const state=createInterviewState({sessionId:'private-current',roleId:'java-backend',durationMinutes:20,skills:[{skillId:'spring-transactions',relevance:1}]},now);
  state.priorEvidence=[{sessionId:'private-old',observationId:'private-observation',roleId:'java-backend',skillId:'spring-transactions',questionId:'historical-q',
    questionType:'technical',difficulty:1,score:.2,quality:1,observedAt:now-1000,rubricId:'r',rubricVersion:'old-1',evidenceMode:'offline-fixture'}];
  const f=await createEvaluationFixture(context=>{
    const user=context.messages.find(m=>m.role==='user'); const text=contentText(user!.content);
    const payload=JSON.parse(text); expect(payload.memory).toHaveLength(1); expect(payload.memory[0].observedAt).toBe(now-1000);
    expect(text).not.toContain('private-old'); expect(text).not.toContain('private-current'); expect(text).not.toContain('private-observation'); observed=true;
    return plannerReply(context);
  });
  const result=await createPiQuestionPlanner({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model})({state,
    context:{userId:'host-user',roleId:'java-backend',runId:'recall',attemptId:'a',deadlineAt:now+30000},goal:'练习事务',askedQuestionIds:[],allowDraftKnowledge:true},new AbortController().signal);
  expect(result.selection.status).toBe('selected'); expect(observed).toBe(true); expect(f.stats.liveModelCalls).toBe(0);
});
