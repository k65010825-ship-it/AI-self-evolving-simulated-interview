import { test,expect } from 'bun:test';
import { buildInterviewContext } from '../apps/agent/src/context/build-context.ts';
import { fitMemoryContext } from '../apps/agent/src/context/memory-view.ts';
import { restoredScenario } from '../experiments/pi-sdk/memory-context-fixture.ts';
import { recallStateEvidence,projectMemoryForPrompt } from '../apps/agent/src/memory/recall.ts';
import { estimateSkills,decideNextAction } from '../apps/agent/src/planning/interview-state.ts';
import { MemoryContextAuditSchema } from '../packages/contracts/src/memory.ts';


test('restored history survives budget compaction with full skill estimates/confidence, exact provenance and no prompt business IDs',()=>{
 const now=200*86400000;
 for(const roleId of ['java-backend','web-frontend']as const){
  const{state,restored}=restoredScenario(roleId,now),before=JSON.stringify({state,restored});
  const input={state,now,goal:'联合回归',phase:'questioning',answer:'',knowledge:[]};
  const wide=buildInterviewContext(input),p=JSON.parse(wide.userPrompt);
  const empty=buildInterviewContext(input,{memoryRecall:{maxItems:0}});
  const tight=buildInterviewContext(input,{maxCharacters:empty.audit.characterCount});
  const t=JSON.parse(tight.userPrompt),recall=recallStateEvidence(state,now);
  expect(p.memory).toEqual(projectMemoryForPrompt(recall.selected));expect(p.memory.length).toBe(2);
  expect(p.memory[0].rubricVersion).toBe('original-1');expect(p.memory[0].evidenceMode).toBe('offline-fixture');
  expect(t.memory).toEqual([]);expect(t.state.skills).toEqual(estimateSkills(state,now));expect(t.state.skills).toEqual(p.state.skills);
  expect(tight.audit.memory.reasonCounts.context_budget).toBe(2);expect(JSON.stringify(t)).not.toContain('private-');
  expect(tight.audit.memory.included).toEqual([]);
  expect(wide.audit.memory.included).toEqual(recall.selected.map(e=>({sessionId:e.sessionId,observationId:e.observationId})));
  expect(recall.askedQuestionIds).toContain('repeated-old');expect(recall.selected.some(e=>e.questionId==='repeated-old')).toBe(false);
  expect(decideNextAction(state,now)).toEqual(decideNextAction(JSON.parse(JSON.stringify(state)),now));
  expect(JSON.stringify({state,restored})).toBe(before);
 }
});
test('count-only audit rejects impossible totals and unknown identity fields',()=>{
 const now=200*86400000,{state}=restoredScenario('java-backend',now);
 const result=fitMemoryContext(recallStateEvidence(state,now),'questioning',()=>true);
 expect(MemoryContextAuditSchema.safeParse({...result.audit,includedCount:30}).success).toBe(false);
 expect(MemoryContextAuditSchema.safeParse({...result.audit,selectedCount:0}).success).toBe(false);
 expect(MemoryContextAuditSchema.safeParse({...result.audit,userId:'private-user'}).success).toBe(false);
});
test('shared projection keeps complete evidence entries, rejects optional entries individually, and isolates scoring',()=>{
 const now=200*86400000,{state}=restoredScenario('java-backend',now),recall=recallStateEvidence(state,now);
 const result=fitMemoryContext(recall,'questioning',items=>items.length<=1);
 expect(result.memory).toEqual(projectMemoryForPrompt(recall.selected.slice(0,1)));
 expect(result.audit.includedCount).toBe(1);expect(result.audit.reasonCounts.context_budget).toBe(1);
 expect(result.audit.sourceCount).toBe(result.audit.includedCount+result.audit.excludedCount);
 const skipFirst=fitMemoryContext(recall,'questioning',items=>items.every(e=>e.skillId===recall.selected[1]!.skillId));
 expect(skipFirst.memory).toEqual(projectMemoryForPrompt(recall.selected.slice(1)));
 expect(skipFirst.audit.reasonCounts.context_budget).toBe(1);
 const scoring=fitMemoryContext(recall,'scoring',()=>true);
 expect(scoring.memory).toEqual([]);expect(scoring.audit.reasonCounts.scoring_isolation).toBe(2);
 expect(JSON.stringify(scoring.audit)).not.toContain('private-');
});
