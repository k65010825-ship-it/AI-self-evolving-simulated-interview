import { expect, test } from 'bun:test';
import { createMemory, appendMemory, restoreMemory, startSessionFromMemory } from '../apps/agent/src/memory/session-memory.ts';
import { runPiInterviewDemo } from '../scripts/demo-pi-interview.ts';
import { estimateSkills, decideNextAction,recordObservation } from '../apps/agent/src/planning/interview-state.ts';
import { selectNextQuestion } from '../apps/agent/src/planning/select-question.ts';
import java from '../knowledge/java-backend/seed.json' with { type: 'json' };
import { buildInterviewReport } from '../apps/agent/src/reporting/build-report.ts';
import { evaluateTurn } from '../apps/agent/src/orchestration/evaluate-turn.ts';
const identity = { userId:'demo',roleId:'java-backend' };
async function fixture() {
  const demo = await runPiInterviewDemo(); const now = demo.reportInput.generatedAt + 1000;
  const memory = createMemory(identity,now);
  const request = { ...identity,expectedVersion:0,sessionStatus:'completed',now,reportInput:demo.reportInput };
  return { memory,request,now };
}
test('stores only minimum verified session evidence, no answers, feedback or runtime identities', async () => {
  const f=await fixture(); const result=await appendMemory(f.memory,f.request);
  expect(result.version).toBe(1); expect(result.sessions).toHaveLength(1);
  expect(result.sessions[0]?.observations[0]?.rubricVersion).toBe('seed-0.1');
  expect(JSON.stringify(result)).not.toContain('事务边界需要说明');
  expect(JSON.stringify(result)).not.toContain('demo-attempt'); expect(f.memory.version).toBe(0);
});
test('same completed session replays idempotently while stale or changed content conflicts', async () => {
  const f=await fixture(); const next=await appendMemory(f.memory,f.request);
  expect((await appendMemory(next,f.request)).version).toBe(1);
  const changed=structuredClone(f.request); changed.reportInput.policyVersion='other';
  await expect(appendMemory(next,changed)).rejects.toThrow('VERSION_CONFLICT');
  await expect(appendMemory(f.memory,{ ...f.request,expectedVersion:1 })).rejects.toThrow('VERSION_CONFLICT');
});
test('rejects user or role mismatch and validates all report evidence before append', async () => {
  const f=await fixture();
  await expect(appendMemory(f.memory,{ ...f.request,userId:'other' })).rejects.toThrow('FORBIDDEN');
  await expect(appendMemory(f.memory,{ ...f.request,roleId:'web-frontend' })).rejects.toThrow('ROLE_FORBIDDEN');
  const bad=structuredClone(f.request); bad.reportInput.turns[0]!.proposal.evaluation.normalizedScore=0.01;
  await expect(appendMemory(f.memory,bad)).rejects.toThrow('VALIDATION_ERROR');
  await expect(appendMemory(f.memory,{ ...f.request,sessionStatus:'running' })).rejects.toThrow('VALIDATION_ERROR');
});
test('JSON recovery checks identity, malformed data and schema version', async () => {
  const f=await fixture(); const next=await appendMemory(f.memory,f.request);
  expect(restoreMemory(JSON.stringify(next),identity)).toEqual(next);
  expect(()=>restoreMemory(JSON.stringify(next),{ ...identity,userId:'other' })).toThrow('FORBIDDEN');
  expect(()=>restoreMemory(JSON.stringify(next),{ ...identity,roleId:'web-frontend' })).toThrow('ROLE_FORBIDDEN');
  expect(()=>restoreMemory('{',identity)).toThrow('VALIDATION_ERROR');
  expect(()=>restoreMemory(JSON.stringify({...next,schemaVersion:2}),identity)).toThrow('VALIDATION_ERROR');
});
test('restored history guides estimates without consuming this session observations, version or turn budget', async () => {
  const f=await fixture(); const memory=await appendMemory(f.memory,f.request);
  const state=startSessionFromMemory(memory,{ ...identity,now:f.now+1000,session:{ sessionId:'next',roleId:'java-backend',durationMinutes:20,
    skills:[{skillId:'spring-transactions',relevance:1},{skillId:'java-concurrency',relevance:1}] } });
  expect(state.observations).toHaveLength(0); expect(state.version).toBe(0); expect(state.currentSkillId).toBeNull();
  const estimates=estimateSkills(state,f.now+1000);
  expect(estimates[0]?.mastery).toBeCloseTo(0.75); expect(estimates[0]?.covered).toBe(false);
  expect(decideNextAction(state,f.now+1000,{maxTurns:1}).action).not.toBe('finish');
  const selected=selectNextQuestion({state,now:f.now+1000,knowledge:java,askedQuestionIds:[]},{allowDraftKnowledge:true});
  expect(selected.status).toBe('selected'); if(selected.status==='selected') expect(selected.question.id).toBe(java[1]!.id);
});
test('original history timestamps decay and cannot be refreshed just by starting a new session', async () => {
  const f=await fixture(); const memory=await appendMemory(f.memory,f.request);
  const session={sessionId:'later',roleId:'java-backend',durationMinutes:20,skills:[{skillId:'spring-transactions',relevance:1}]};
  const early=startSessionFromMemory(memory,{...identity,now:f.now+1,session});
  const late=startSessionFromMemory(memory,{...identity,now:f.now+7*86400000,session});
  expect(estimateSkills(late,late.startedAt)[0]!.confidence).toBeLessThan(estimateSkills(early,early.startedAt)[0]!.confidence);
  expect(late.priorEvidence[0]?.observedAt).toBe(early.priorEvidence[0]?.observedAt);
  expect(selectNextQuestion({state:late,now:late.startedAt,knowledge:java,askedQuestionIds:[]},{allowDraftKnowledge:true}).status).toBe('unavailable');
});
test('rejects time rollback, session reuse and hidden history corruption', async () => {
  const f=await fixture(); const memory=await appendMemory(f.memory,f.request);
  await expect(appendMemory(memory,{...f.request,now:f.now-1})).rejects.toThrow('VALIDATION_ERROR');
  const session={sessionId:f.request.reportInput.state.sessionId,roleId:'java-backend',durationMinutes:20,
    skills:[{skillId:'spring-transactions',relevance:1}]};
  expect(()=>startSessionFromMemory(memory,{...identity,now:f.now+1,session})).toThrow('VERSION_CONFLICT');
  const corrupt=structuredClone(memory); corrupt.sessions[0]!.observations[0]!.roleId='web-frontend';
  expect(()=>restoreMemory(JSON.stringify(corrupt),identity)).toThrow('VALIDATION_ERROR');
});
test('reports retain historical provenance and rubric versions without claiming current-session coverage', async()=>{
  const f=await fixture(); const memory=await appendMemory(f.memory,f.request);
  const state=startSessionFromMemory(memory,{...identity,now:f.now+1,session:{sessionId:'report-next',roleId:'java-backend',durationMinutes:20,
    skills:[{skillId:'spring-transactions',relevance:1}]}});
  const report=await buildInterviewReport({state,generatedAt:state.startedAt,policyVersion:'v0',skillLabels:{'spring-transactions':'事务'},turns:[]});
  expect(report.evidenceMode).toBe('offline-fixture'); expect(report.skills[0]?.rubricVersions).toHaveLength(1);
  expect(report.coverage.observedSkills).toBe(0); expect(report.warnings).toContain('includes_prior_session_evidence');
});
test('historical question cannot be reassigned to another skill before evaluation',async()=>{
  const f=await fixture(); const memory=await appendMemory(f.memory,f.request);
  const state=startSessionFromMemory(memory,{...identity,now:f.now+1,session:{sessionId:'invalid-next',roleId:'java-backend',durationMinutes:20,
    skills:[{skillId:'spring-transactions',relevance:1},{skillId:'java-concurrency',relevance:1}]}});
  const raw=structuredClone(f.request.reportInput.turns[0]!.input);raw.state=state;raw.expectedVersion=0;
  raw.question.skillId='java-concurrency';let calls=0;
  await expect(evaluateTurn(raw,{now:()=>state.startedAt,evaluate:async()=>{calls++;return{};}})).rejects.toThrow('VALIDATION_ERROR');
  expect(calls).toBe(0);
});
test('an exact old-session retry remains idempotent after a newer session was appended',async()=>{
  const f=await fixture();const first=await appendMemory(f.memory,f.request);
  const second=structuredClone(f.request);second.expectedVersion=1;second.now=f.now+1000;
  second.reportInput.state.sessionId='session-b';
  for(const t of second.reportInput.turns){t.input.state.sessionId='session-b';t.proposal.basedOn.sessionId='session-b';t.proposal.nextState.sessionId='session-b';}
  const memory=await appendMemory(first,second);
  expect((await appendMemory(memory,f.request)).version).toBe(2);
});
test('repeating a historical question does not refresh independent evidence or mastery',async()=>{
 const f=await fixture();const memory=await appendMemory(f.memory,f.request);
 const state=startSessionFromMemory(memory,{...identity,now:f.now+1,session:{sessionId:'repeat',roleId:'java-backend',durationMinutes:20,
  skills:[{skillId:'spring-transactions',relevance:1}]}});
 const old=state.priorEvidence[0]!;
 const next=recordObservation(state,{observationId:'repeat-o',roleId:state.roleId,skillId:old.skillId,questionId:old.questionId,
  questionType:old.questionType,difficulty:old.difficulty,score:0.1,quality:1,observedAt:state.startedAt},0,state.startedAt);
 expect(estimateSkills(next,state.startedAt)[0]?.independentQuestions).toBe(1);
 expect(estimateSkills(next,state.startedAt)[0]?.mastery).toBeCloseTo(0.75);
});
test('capacity overflow is explicit instead of silently dropping old sessions',async()=>{
 const f=await fixture();const one=await appendMemory(f.memory,f.request);const template=one.sessions[0]!;
 const full={...one,version:20,sessions:Array.from({length:20},(_,i)=>{const s=structuredClone(template);s.sessionId=`past-${i}`;
  s.observations.forEach(o=>{o.sessionId=s.sessionId;});return s;})};
 await expect(appendMemory(full,{...f.request,expectedVersion:20,now:f.now+1})).rejects.toThrow('VALIDATION_ERROR');
});
