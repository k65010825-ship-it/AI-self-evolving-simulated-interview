import { pathToFileURL } from 'node:url';
import java from '../knowledge/java-backend/seed.json' with {type:'json'};
import web from '../knowledge/web-frontend/seed.json' with {type:'json'};
import { runPiInterviewDemo } from './demo-pi-interview.ts';
import { createMemory,appendMemory,restoreMemory,startSessionFromMemory } from '../apps/agent/src/memory/session-memory.ts';
import { estimateSkills } from '../apps/agent/src/planning/interview-state.ts';
import { selectNextQuestion } from '../apps/agent/src/planning/select-question.ts';
import { evaluateTurn } from '../apps/agent/src/orchestration/evaluate-turn.ts';
import { createPiEvaluator } from '../apps/agent/src/adapters/pi/evaluator.ts';
import { createEvaluationFixture } from '../experiments/pi-sdk/evaluation-fixture.ts';
import type { RoleId } from '../packages/contracts/src/tools.ts';
export async function runMemoryDemo(roleId:RoleId='java-backend') {
  const first=await runPiInterviewDemo(roleId), identity={userId:'demo',roleId};
  const saved=await appendMemory(createMemory(identity,Date.now()),{...identity,expectedVersion:0,sessionStatus:'completed',
    now:Date.now(),reportInput:first.reportInput});
  // Host-side JSON transport demonstration, not a database or process-restart test.
  const restored=restoreMemory(JSON.stringify(saved),identity);
  const knowledge=roleId==='java-backend'?java:web;
  const state=startSessionFromMemory(restored,{...identity,now:Math.max(Date.now(),restored.updatedAt+1),
    session:{sessionId:'demo-session-2',roleId,durationMinutes:20,skills:knowledge.slice(0,2).map(k=>({skillId:k.skillId,relevance:1}))}});
  const now=()=>Math.max(Date.now(),state.startedAt);
  const selected=selectNextQuestion({state,now:now(),knowledge,askedQuestionIds:[]},{allowDraftKnowledge:true});
  if(selected.status!=='selected') throw new Error('Second session requires unseen demo question');
  const answer={id:'answer-2',text:roleId==='java-backend'?'可见性与原子性需要区分。':'闭包需要考虑变量读取时机。'};
  const fixture=await createEvaluationFixture(()=>({text:JSON.stringify({evidence:[{id:'e1',start:0,end:4,excerpt:answer.text.slice(0,4)}],
    criterionScores:selected.rubric.criteria.map(c=>({criterionId:c.id,score:c.maxScore*0.5,evidenceIds:['e1']})),
    feedback:{strengths:['离线替身的固定反馈'],improvements:['使用不同题补充场景验证']}})}));
  const input={state,expectedVersion:0,observationId:'observation-2',goal:'验证跨会话记忆',
    context:{userId:'demo',runId:'memory-run-2',attemptId:'memory-attempt-2',roleId,deadlineAt:now()+60000},
    question:selected.question,answer,quality:0.8,rubric:selected.rubric,knowledge:[]};
  const proposal=await evaluateTurn(input,{now,evaluate:createPiEvaluator({cwd:process.cwd(),modelRuntime:fixture.runtime,model:fixture.model,roleId})});
  const completedAt=now();
  const next=await appendMemory(restored,{...identity,expectedVersion:1,sessionStatus:'completed',now:completedAt,reportInput:{
    state:proposal.nextState,generatedAt:completedAt,policyVersion:'heuristic-v0',skillLabels:first.reportInput.skillLabels,
    turns:[{input,proposal,evidenceMode:'offline-fixture'}]}});
  return {mode:'offline-memory-json-roundtrip',roleId,liveModelCalls:0,committed:false,memory:next,
    firstQuestionId:first.initial.question.id,secondQuestionId:selected.question.id,
    before:{version:state.version,currentAnswers:state.observations.length,skills:estimateSkills(state,state.startedAt)},
    after:{version:proposal.nextState.version,currentAnswers:proposal.nextState.observations.length,skills:estimateSkills(proposal.nextState,now())}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  for(const role of ['java-backend','web-frontend'] as const) console.log(JSON.stringify(await runMemoryDemo(role),null,2));
}
