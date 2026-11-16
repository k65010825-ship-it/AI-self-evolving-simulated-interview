import { test,expect } from 'bun:test';
import { restoredScenario } from '../experiments/pi-sdk/memory-context-fixture.ts';
import { createEvaluationFixture } from '../experiments/pi-sdk/evaluation-fixture.ts';
import { contentText,plannerReply } from '../experiments/pi-sdk/planner-fixture.ts';
import { createPiQuestionPlanner } from '../apps/agent/src/adapters/pi/question-planner.ts';
import { decideNextAction,estimateSkills } from '../apps/agent/src/planning/interview-state.ts';
import { recallStateEvidence,projectMemoryForPrompt } from '../apps/agent/src/memory/recall.ts';

test('both-role Pi planning preserves full-state skill/confidence and selection when prompt memory is entirely compacted',async()=>{
 for(const roleId of ['java-backend','web-frontend']as const){
  const now=Date.now(),{state,restored,skill}=restoredScenario(roleId,now),before=JSON.stringify({state,restored});
  const observed:{memory:unknown[];skills:unknown;plan:{skillId:string}}[]=[];
  const f=await createEvaluationFixture(context=>{
   const text=contentText(context.messages.find(m=>m.role==='user')!.content),payload=JSON.parse(text);
   observed.push(payload);expect(text).not.toContain('private-');
   // The estimates must match full host evidence, not the optional prompt-memory subset.
   const estimates=estimateSkills(state,Date.now());
   expect(payload.skills.map((s:{mastery:number})=>s.mastery)).toEqual(estimates.map(s=>s.mastery));
   for(const [i,s]of payload.skills.entries())expect(Math.abs(s.confidence-estimates[i]!.confidence)).toBeLessThan(.00001);
   return plannerReply(context);
  });
  const input={state,context:{userId:'private-user',roleId,runId:'joint',attemptId:'a',deadlineAt:now+30000},goal:'联合规划回归',askedQuestionIds:[],allowDraftKnowledge:true};
  const config={cwd:process.cwd(),modelRuntime:f.runtime,model:f.model};
  const wide=await createPiQuestionPlanner(config)(input);const full=observed[0]!;
  expect(full.memory).toEqual(projectMemoryForPrompt(recallStateEvidence(state,now).selected));
  const budget=wide.contextAudit!.characterCount-JSON.stringify(full.memory).length+2+80;
  observed.length=0;
  const tight=await createPiQuestionPlanner({...config,maxInputCharacters:budget})(input);
  expect(observed[0]!.memory).toEqual([]);expect(observed[0]!.plan.skillId).toBe(skill);
  expect(tight.selection.status).toBe('selected');expect(wide.selection.status).toBe('selected');
  if(tight.selection.status==='selected'&&wide.selection.status==='selected'){
   expect(tight.selection.question).toEqual(wide.selection.question);
   for(const field of ['action','skillId','difficulty','reason']as const)expect(tight.selection.plan[field]).toEqual(wide.selection.plan[field]);
  }
  expect(tight.contextAudit!.memory.includedCount).toBe(0);expect(tight.contextAudit!.memory.reasonCounts.context_budget).toBe(2);
  expect(tight.contextAudit!.characterCount).toBeLessThanOrEqual(budget);expect(JSON.stringify(tight.contextAudit)).not.toContain('private-');
  expect(JSON.stringify({state,restored})).toBe(before);expect(f.stats.liveModelCalls).toBe(0);
 }
},15000);

test('historical question stays excluded after memory removal; essential input overflow never calls provider',async()=>{
 for(const roleId of ['java-backend','web-frontend']as const){
  const now=Date.now(),{state,skill}=restoredScenario(roleId,now);
  const bankId=roleId==='java-backend'?'java-scenario-transactions':'web-scenario-autocomplete';
  state.priorEvidence[0]!.questionId=bankId;state.priorEvidence[1]!.questionId=bankId;
  let promptMemory:unknown[]=[];
  const f=await createEvaluationFixture(context=>{
   promptMemory=JSON.parse(contentText(context.messages.find(m=>m.role==='user')!.content)).memory;
   return plannerReply(context);
  }),config={cwd:process.cwd(),modelRuntime:f.runtime,model:f.model};
  const input={state,context:{userId:'private-user',roleId,runId:'excluded',attemptId:'a',deadlineAt:now+30000},goal:'历史排题',askedQuestionIds:[],allowDraftKnowledge:true};
  expect(decideNextAction(state,now).skillId).toBe(skill);
  const wide=await createPiQuestionPlanner(config)(input);
  const budget=wide.contextAudit!.characterCount-JSON.stringify(promptMemory).length+2+80;
  const result=await createPiQuestionPlanner({...config,maxInputCharacters:budget})(input);
  expect(promptMemory).toEqual([]);expect(result.contextAudit!.memory.reasonCounts.context_budget).toBe(2);
  expect(result.selection.status).toBe('unavailable');expect(result.receipts[0]!.data!.items).toEqual([]);
  const calls=f.stats.providerCalls;
  await expect(createPiQuestionPlanner({...config,maxInputCharacters:1})(input)).rejects.toThrow('CONTEXT_BUDGET_EXCEEDED');
  expect(f.stats.providerCalls).toBe(calls);expect(f.stats.liveModelCalls).toBe(0);
 }
},15000);
