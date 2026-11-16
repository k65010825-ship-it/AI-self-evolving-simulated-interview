import { test,expect } from 'bun:test';
import { restoredScenario } from '../experiments/pi-sdk/memory-context-fixture.ts';
import { startSessionFromMemory } from '../apps/agent/src/memory/session-memory.ts';
import { recallMemory } from '../apps/agent/src/memory/recall.ts';
import { buildPracticeGoals } from '../apps/agent/src/learning/practice-plan.ts';
import { createPiQuestionPlanner } from '../apps/agent/src/adapters/pi/question-planner.ts';
import { createEvaluationFixture } from '../experiments/pi-sdk/evaluation-fixture.ts';
import { contentText,plannerReply } from '../experiments/pi-sdk/planner-fixture.ts';
import { evaluateTurn } from '../apps/agent/src/orchestration/evaluate-turn.ts';
import { buildInterviewReport } from '../apps/agent/src/reporting/build-report.ts';

test('both-role restore and practice goals honor strict compatibility while retaining full practice history',()=>{
 const now=200*86400000;
 for(const roleId of ['java-backend','web-frontend']as const){
  const{restored,state:original}=restoredScenario(roleId,now),before=JSON.stringify(restored),identity={userId:'private-user',roleId};
  const session={sessionId:'strict-session',roleId,durationMinutes:20,skills:original.skills,historyCompatibility:{id:'empty-strict',mode:'strict',allowed:[]}};
  const state=startSessionFromMemory(restored,{...identity,session,now});
  expect(state.historyCompatibility!.id).toBe('empty-strict');expect(state.priorEvidence).toHaveLength(4);
  const recall=recallMemory(restored,{...identity,now,skillIds:original.skills.map(s=>s.skillId),historyCompatibility:session.historyCompatibility});
  expect(recall.selected).toEqual([]);expect(recall.askedQuestionIds).toHaveLength(3);
  const goals=buildPracticeGoals(restored,{...identity,session,now});
  expect(goals.goals.length).toBeGreaterThan(0);expect(goals.goals.every(g=>g.mastery===null&&g.confidence===0&&g.evidence.length===0)).toBe(true);
  expect(goals.excludedQuestionIds).toHaveLength(3);expect(JSON.stringify(restored)).toBe(before);
 }
});

test('actual offline Pi receives no incompatible historical scores but still gets host planning and safe policy audit',async()=>{
 for(const roleId of ['java-backend','web-frontend']as const){
  const now=Date.now(),{state}=restoredScenario(roleId,now);
  state.historyCompatibility={id:'strict-offline',mode:'strict',allowed:[]};let observed=0;
  const f=await createEvaluationFixture(context=>{
   const payload=JSON.parse(contentText(context.messages.find(m=>m.role==='user')!.content));
   expect(payload.memory).toEqual([]);expect(payload.skills.every((s:{mastery:unknown;confidence:number})=>s.mastery===null&&s.confidence===0)).toBe(true);
   observed++;return plannerReply(context);
  });
  const result=await createPiQuestionPlanner({cwd:process.cwd(),modelRuntime:f.runtime,model:f.model})({state,goal:'严格历史规划',askedQuestionIds:[],allowDraftKnowledge:true,
   context:{userId:'private-user',roleId,runId:'strict',attemptId:'a',deadlineAt:now+30000}});
  expect(result.selection.status).toBe('selected');expect(result.contextAudit!.memory.includedCount).toBe(0);
  expect(result.contextAudit!.memory.reasonCounts.rubric_incompatible).toBe(3);
  expect(result.contextAudit!.historyCompatibility!.mode).toBe('strict');expect(observed).toBe(2);expect(f.stats.liveModelCalls).toBe(0);
 }
},15000);

test('report replay rejects swapping history compatibility after the evaluated turn',async()=>{
 const now=200*86400000,{state}=restoredScenario('java-backend',now);
 state.historyCompatibility={id:'pinned-compat',mode:'strict',allowed:[]};
 const input={state,expectedVersion:0,observationId:'new-observation',goal:'验证政策固定',quality:1,knowledge:[],
  context:{userId:'private-user',roleId:'java-backend',runId:'r',attemptId:'a',deadlineAt:now+60000},
  question:{id:'fresh-question',roleId:'java-backend',skillId:'spring-transactions',text:'解释事务',questionType:'technical',difficulty:2},answer:{id:'answer',text:'事务边界'},
  rubric:{id:'current-rubric',version:'3',roleId:'java-backend',scope:'technical-content',criteria:[{id:'correct',maxScore:4,weight:1,required:true,description:'边界'}]}};
 const proposal=await evaluateTurn(input,{now:()=>now,evaluate:async()=>({evidence:[{id:'e',start:0,end:4,excerpt:'事务边界'}],criterionScores:[{criterionId:'correct',score:2,evidenceIds:['e']}],feedback:{strengths:['边界'],improvements:['补充场景']}})});
 const raw={state:proposal.nextState,generatedAt:now,policyVersion:'p',skillLabels:Object.fromEntries(state.skills.map(s=>[s.skillId,s.skillId])),turns:[{input,proposal,evidenceMode:'offline-fixture'}]};
 expect((await buildInterviewReport(raw)).skills.find(s=>s.skillId==='spring-transactions')!.mastery).toBe(.5);
 const changed=structuredClone(raw);changed.state.historyCompatibility!.id='changed-after-turn';
 await expect(buildInterviewReport(changed)).rejects.toThrow('VALIDATION_ERROR');
});
