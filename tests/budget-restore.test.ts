import{test,expect}from'bun:test';
import{createModelBudgetGate}from'../apps/agent/src/model-access/budget.ts';
import config from'../apps/agent/src/model-access/bailian.example.json'with{type:'json'};
test('budget checkpoints happen before dispatch returns and restore rejects tampered totals or profile',()=>{
 const scope={budgetId:'r',userId:'u',roleId:'java-backend' as const,runId:'r',attemptId:'a',deadlineAt:1000},snapshots:unknown[]=[];
 const g=createModelBudgetGate(config.profile,scope,{allowLive:true,now:()=>0,onCheckpoint:s=>snapshots.push(s)});
 g.reserve('http-1',{inputTokens:100,outputTokens:30});g.dispatch('http-1');expect(snapshots).toHaveLength(2);
 const restored=createModelBudgetGate(config.profile,scope,{allowLive:true,now:()=>0,restore:g.snapshot()});expect(restored.snapshot()).toEqual(g.snapshot());
 restored.markUnknown('http-1');restored.settle('http-1',{inputTokens:10,outputTokens:2,complete:true});expect(restored.snapshot().totals.usedTokens).toBe(12);
 const bad=structuredClone(g.snapshot());bad.totals.heldTokens=0;
 expect(()=>createModelBudgetGate(config.profile,scope,{allowLive:true,now:()=>0,restore:bad})).toThrow('MODEL_STATE_CONFLICT');
 const failed=createModelBudgetGate(config.profile,scope,{allowLive:true,now:()=>0,onCheckpoint:()=>{throw Error('disk failure');}});
 expect(()=>failed.reserve('http-1',{inputTokens:100,outputTokens:30})).toThrow('disk failure');
});
