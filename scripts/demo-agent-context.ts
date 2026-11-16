import { createInterviewState } from '../apps/agent/src/planning/interview-state.ts';
import { buildInterviewContext } from '../apps/agent/src/context/build-context.ts';
import { restoredScenario } from '../experiments/pi-sdk/memory-context-fixture.ts';
import { pathToFileURL } from 'node:url';
import type { RoleId } from '../packages/contracts/src/tools.ts';
import {estimateSkills}from'../apps/agent/src/planning/interview-state.ts';
import {describeHistoryCompatibility}from'../apps/agent/src/memory/history-compatibility.ts';
import {recallStateEvidence}from'../apps/agent/src/memory/recall.ts';
export function runScoringIsolationDemo(roleId:RoleId='java-backend'){
  const now=200*86400000,{state}=restoredScenario(roleId,now),other=structuredClone(state);other.priorEvidence.forEach(e=>{e.score=.99;});
  const before=JSON.stringify([state,other]);
  const make=(s:typeof state,goal:string)=>buildInterviewContext({state:s,now,goal,phase:'scoring',answer:'边界条件',knowledge:[]});
  const low=make(state,'合成低画像目标'),high=make(other,'合成高画像目标');
  const identical=low.userPrompt===high.userPrompt&&low.systemPrompt===high.systemPrompt;
  if(!identical||JSON.stringify([state,other])!==before)throw Error('CONTEXT_DEMO_INVARIANT_FAILED');
  return{roleId,mode:'offline-scoring-isolation',identical,fieldNames:Object.keys(JSON.parse(low.userPrompt)),
    characterCount:low.audit.characterCount,hostHistoryRetained:true,liveModelCalls:0,committed:false};
}
export function runHistoryCompatibilityDemo(roleId:RoleId='java-backend'){
  const now=200*86400000,{state,skill}=restoredScenario(roleId,now);
  // Synthetic version variation only; no persisted snapshot or real historical grade is changed.
  state.priorEvidence[2]!.rubricVersion='original-2';
  const legacy=estimateSkills(state,now);
  state.historyCompatibility={id:'synthetic-compat-v1',mode:'strict',allowed:[{skillId:skill,rubricId:'original-rubric',rubricVersion:'original-2'}]};
  const before=JSON.stringify(state),strict=estimateSkills(state,now),recall=recallStateEvidence(state,now);
  if(JSON.stringify(state)!==before||recall.askedQuestionIds.length!==3)throw Error('CONTEXT_DEMO_INVARIANT_FAILED');
  return{roleId,mode:'synthetic-history-compatibility',legacy,strict,audit:describeHistoryCompatibility(state),askedCount:recall.askedQuestionIds.length,
    recallCount:recall.selected.length,originalEvidenceCount:state.priorEvidence.length,liveModelCalls:0,committed:false};
}
export function runContextJointDemo(roleId:RoleId='java-backend'){
  const now=200*86400000,{state,restored}=restoredScenario(roleId,now),before=JSON.stringify({state,restored});
  const input={state,now,goal:'恢复与压缩联合验证',phase:'questioning',answer:'',knowledge:[]};
  const wide=buildInterviewContext(input),empty=buildInterviewContext(input,{memoryRecall:{maxItems:0}});
  const tight=buildInterviewContext(input,{maxCharacters:empty.audit.characterCount});
  const widePayload=JSON.parse(wide.userPrompt),tightPayload=JSON.parse(tight.userPrompt);
  if(JSON.stringify(widePayload.state.skills)!==JSON.stringify(tightPayload.state.skills)||JSON.stringify({state,restored})!==before)
    throw Error('CONTEXT_DEMO_INVARIANT_FAILED');
  return{roleId,evidenceMode:'offline-fixture',wide:wide.audit.memory,tight:tight.audit.memory,skills:tightPayload.state.skills,
    originalEvidenceCount:state.priorEvidence.length,unchanged:true,liveModelCalls:0,committed:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
const now = 1000000;
const state = createInterviewState({ sessionId: 'demo-session', roleId: 'java-backend', durationMinutes: 20,
  skills: [{ skillId: 'spring-transactions', relevance: 1 }] }, now);
const result = buildInterviewContext({ state, now, goal: '验证事务知识表达', phase: 'questioning',
  answer: '我会先解释事务边界。', knowledge: [] });
console.log(JSON.stringify({ mode: 'offline-context-demo', promptVersion: result.promptVersion,
  audit: result.audit, payload: JSON.parse(result.userPrompt) }, null, 2));
for(const roleId of ['java-backend','web-frontend']as const){
 const joint=runContextJointDemo(roleId);
 console.log(JSON.stringify({mode:'offline-memory-context-joint',roleId,originalEvidenceCount:joint.originalEvidenceCount,
   wideIncluded:joint.wide.includedCount,tightIncluded:joint.tight.includedCount,tightReasons:joint.tight.reasonCounts,
   unchanged:joint.unchanged,liveModelCalls:joint.liveModelCalls,committed:joint.committed}));
 const versioned=runHistoryCompatibilityDemo(roleId);
 console.log(JSON.stringify({mode:versioned.mode,roleId,audit:versioned.audit,legacyMastery:versioned.legacy[0]!.mastery,strictMastery:versioned.strict[0]!.mastery,
   askedCount:versioned.askedCount,recallCount:versioned.recallCount,originalEvidenceCount:versioned.originalEvidenceCount,liveModelCalls:0,committed:false}));
 console.log(JSON.stringify(runScoringIsolationDemo(roleId)));
}
}
