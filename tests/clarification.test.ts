import { test,expect } from 'bun:test';
import { createInterviewState } from '../apps/agent/src/planning/interview-state.ts';
import { evaluateTurnWithClarification } from '../apps/agent/src/orchestration/clarify-turn.ts';
import { evaluateTurn } from '../apps/agent/src/orchestration/evaluate-turn.ts';

const now=1000000;
const input=()=>({state:createInterviewState({sessionId:'s',roleId:'java-backend',durationMinutes:20,skills:[{skillId:'transactions',relevance:1}]},now),
 expectedVersion:0,observationId:'o',goal:'练习',context:{userId:'u',roleId:'java-backend',runId:'r',attemptId:'a',deadlineAt:now+60000},
 question:{id:'q',roleId:'java-backend',skillId:'transactions',questionType:'technical',difficulty:2,text:'解释事务边界'},answer:{id:'a',text:'事务边界'},quality:1,knowledge:[],
 rubric:{id:'r',version:'1',roleId:'java-backend',scope:'technical-content',criteria:[{id:'correct',maxScore:4,weight:.5,required:true},{id:'depth',maxScore:4,weight:.5,required:true}]}});
const output=(score:number|null)=>({evidence:score===null?[]:[{id:'e',start:0,end:4,excerpt:'事务边界'}],
 criterionScores:['correct','depth'].map(criterionId=>({criterionId,score,evidenceIds:score===null?[]:['e']})),feedback:{strengths:[],improvements:['补充说明']}});

test('legal null requests neutral clarification without state/grade mutation; zero with evidence stays graded',async()=>{
 const raw=input(),before=JSON.stringify(raw),deps={now:()=>now,evaluate:async()=>output(null)};
 const result=await evaluateTurnWithClarification(raw,deps,{});
 expect(result.status).toBe('needs_clarification');if(result.status==='scored')throw Error('unexpected');
 expect(result.normalizedScore).toBeNull();expect(result.attempt).toBe(1);expect(result.missingCriterionIds).toEqual(['correct','depth']);
 expect(JSON.stringify(raw)).toBe(before);expect(JSON.stringify(result)).not.toContain('nextState');
 expect(result.clarification).not.toContain('回滚');
 const graded=await evaluateTurnWithClarification(raw,{now:()=>now,evaluate:async()=>output(0)},{});
 expect(graded.status).toBe('scored');if(graded.status==='scored')expect(graded.proposal.evaluation.normalizedScore).toBe(0);
 await expect(evaluateTurn(raw,deps)).rejects.toThrow('MODEL_OUTPUT_INVALID');
});
test('supplement preserves original answer and pins question/state/policy; full score then records just one observation',async()=>{
 const raw=input(),first=await evaluateTurnWithClarification(raw,{now:()=>now,evaluate:async()=>output(null)},{});
 if(first.status!=='needs_clarification')throw Error('expected clarification');
 const supplemented={...raw,answer:{id:'a2',text:'事务边界\n补充：说明异常处理'},context:{...raw.context,runId:'r2',attemptId:'a2'}};
 const second=await evaluateTurnWithClarification(supplemented,{now:()=>now+1000,evaluate:async r=>{
  expect(JSON.parse(r.context.userPrompt).answer.text).toBe(supplemented.answer.text);return output(2);
 }},{previous:first});
 expect(second.status).toBe('scored');if(second.status==='scored'){expect(second.proposal.nextState.version).toBe(1);expect(second.proposal.nextState.observations).toHaveLength(1);}
 let calls=0;const deps={now:()=>now+1000,evaluate:async()=>{calls++;return output(2);}};
 await expect(evaluateTurnWithClarification({...supplemented,answer:{id:'a2',text:'改写原答案'}},deps,{previous:first})).rejects.toThrow('VERSION_CONFLICT');
 const changed=structuredClone(supplemented);changed.rubric.version='2';
 await expect(evaluateTurnWithClarification(changed,deps,{previous:first})).rejects.toThrow('VERSION_CONFLICT');expect(calls).toBe(0);
});
test('exhaustion and insufficient remaining time abstain with null instead of partial/zero score',async()=>{
 const raw=input(),first=await evaluateTurnWithClarification(raw,{now:()=>now,evaluate:async()=>output(null)},{});
 if(first.status!=='needs_clarification')throw Error('expected clarification');
 const second=await evaluateTurnWithClarification({...raw,answer:{id:'a2',text:'事务边界\n仍不确定'},context:{...raw.context,runId:'r2'}},{now:()=>now+1000,evaluate:async()=>output(null)},{previous:first});
 expect(second.status).toBe('abstained');if(second.status!=='scored'){expect(second.reason).toBe('clarification_limit');expect(second.normalizedScore).toBeNull();}
 const near=structuredClone(raw);near.state.deadlineAt=now+30000;
 const limited=await evaluateTurnWithClarification(near,{now:()=>now,evaluate:async()=>output(null)},{});
 expect(limited.status).toBe('abstained');if(limited.status!=='scored')expect(limited.reason).toBe('time_budget');
});
test('omitted dimensions, unknown references and null with evidence are invalid; partial explicit null is unscored',async()=>{
 const missing=output(null);missing.criterionScores.pop();
 const unknown=output(2);unknown.criterionScores[0]!.evidenceIds=['fake'];
 const citedNull=output(2);citedNull.criterionScores[0]!.score=null;
 for(const bad of [missing,unknown,citedNull])await expect(evaluateTurnWithClarification(input(),{now:()=>now,evaluate:async()=>bad},{})).rejects.toThrow('MODEL_OUTPUT_INVALID');
 const partial=output(2);partial.criterionScores[1]!.score=null;partial.criterionScores[1]!.evidenceIds=[];
 const r=await evaluateTurnWithClarification(input(),{now:()=>now,evaluate:async()=>partial},{});
 expect(r.status).toBe('needs_clarification');if(r.status!=='scored'){expect(r.missingCriterionIds).toEqual(['depth']);expect(r.normalizedScore).toBeNull();}
});
test('receipt tampering, policy reset, stale state and terminal receipt cannot trigger another evaluation',async()=>{
 const raw=input(),first=await evaluateTurnWithClarification(raw,{now:()=>now,evaluate:async()=>output(null)},{});
 if(first.status!=='needs_clarification')throw Error('expected clarification');
 const next={...raw,answer:{id:'a2',text:'事务边界\n补充说明'},context:{...raw.context,runId:'r2'}};
 let calls=0;const deps={now:()=>now+1000,evaluate:async()=>{calls++;return output(null);}};
 const forged=structuredClone(first);forged.attempt=0;
 await expect(evaluateTurnWithClarification(next,deps,{previous:forged})).rejects.toThrow();
 await expect(evaluateTurnWithClarification(next,deps,{previous:first,policy:{maxClarifications:2,minRemainingSeconds:45}})).rejects.toThrow('VERSION_CONFLICT');
 const stale=structuredClone(next);stale.state.skills[0]!.relevance=.5;
 await expect(evaluateTurnWithClarification(stale,deps,{previous:first})).rejects.toThrow('VERSION_CONFLICT');
 expect(calls).toBe(0);
 const done=await evaluateTurnWithClarification(next,deps,{previous:first});if(done.status==='scored')throw Error('expected unscored');
 await expect(evaluateTurnWithClarification({...next,answer:{id:'a3',text:next.answer.text+'\n再补充'},context:{...raw.context,runId:'r3'}},deps,{previous:done})).rejects.toThrow('VERSION_CONFLICT');
 expect(calls).toBe(1);
});
test('pre-cancel and late response remain errors instead of producing clarification receipts',async()=>{
 const c=new AbortController();c.abort();let calls=0;
 await expect(evaluateTurnWithClarification(input(),{now:()=>now,signal:c.signal,evaluate:async()=>{calls++;return output(null);}},{})).rejects.toThrow('RUN_CANCELLED');
 expect(calls).toBe(0);
 let at=now;const raw=input();raw.context.deadlineAt=now+10;
 await expect(evaluateTurnWithClarification(raw,{now:()=>at,evaluate:async()=>{at=now+11;return output(null);}},{})).rejects.toThrow('DEADLINE_EXCEEDED');
});
test('two permitted clarification prompts are bounded and the third unresolved evaluation abstains',async()=>{
 const raw=input(),deps={now:()=>now,evaluate:async()=>output(null)};
 const first=await evaluateTurnWithClarification(raw,deps,{policy:{maxClarifications:2,minRemainingSeconds:45}});
 if(first.status!=='needs_clarification')throw Error('expected prompt');
 const next={...raw,answer:{id:'a2',text:raw.answer.text+'\n第一次补充'},context:{...raw.context,runId:'r2'}};
 const second=await evaluateTurnWithClarification(next,deps,{previous:first});
 expect(second.status).toBe('needs_clarification');if(second.status!=='needs_clarification')throw Error('expected second prompt');
 expect(second.attempt).toBe(2);
 const third=await evaluateTurnWithClarification({...next,answer:{id:'a3',text:next.answer.text+'\n第二次补充'},context:{...raw.context,runId:'r3'}},deps,{previous:second});
 expect(third.status).toBe('abstained');if(third.status!=='scored')expect(third.attempt).toBe(2);
});
