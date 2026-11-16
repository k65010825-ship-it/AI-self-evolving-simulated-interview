import{test,expect}from'bun:test';
import{ModelRecoveryPolicySchema}from'../packages/contracts/src/model-recovery.ts';
import{retryDelay,waitForRecovery}from'../apps/agent/src/model-access/recovery.ts';
import{createModelBudgetGate}from'../apps/agent/src/model-access/budget.ts';
import config from'../apps/agent/src/model-access/bailian.example.json'with{type:'json'};
test('bounded exponential jitter and Retry-After never retry early past the permitted wait',()=>{
 const p=ModelRecoveryPolicySchema.parse({httpMaxAttempts:3,maxModelRepairs:1,baseDelayMs:100,maxDelayMs:1500});
 expect(retryDelay(null,1,p,0,()=>1)).toBe(100);expect(retryDelay(null,2,p,0,()=>0)).toBe(100);
 expect(retryDelay('1',1,p,0,()=>0)).toBe(1000);expect(retryDelay('2',1,p,0,()=>0)).toBeNull();
 expect(retryDelay('0'.repeat(127)+'60',1,p,0,()=>1)).toBeNull();
 expect(retryDelay('Thu, 01 Jan 1970 00:00:01 GMT',1,p,0,()=>0)).toBe(1000);
 expect(ModelRecoveryPolicySchema.parse({}).httpMaxAttempts).toBe(1);expect(ModelRecoveryPolicySchema.parse({}).maxModelRepairs).toBe(0);
 expect(()=>ModelRecoveryPolicySchema.parse({...p,httpMaxAttempts:4})).toThrow();
});
test('recovery waits honor abort, absolute deadline and synchronous late clock advancement',async()=>{
 const c=new AbortController();c.abort();await expect(waitForRecovery(5,{signal:c.signal,deadlineAt:100,now:()=>0})).rejects.toThrow('RUN_CANCELLED');
 await expect(waitForRecovery(20,{signal:new AbortController().signal,deadlineAt:10,now:()=>0})).rejects.toThrow('DEADLINE_EXCEEDED');
 let now=0;await expect(waitForRecovery(1,{signal:new AbortController().signal,deadlineAt:5,now:()=>now,sleep:async()=>{now=6;}})).rejects.toThrow('DEADLINE_EXCEEDED');
});
test('explicit HTTP rejection retains worst-case budget, frees slot and can later reconcile real usage',()=>{
 const gate=createModelBudgetGate(config.profile,{budgetId:'rejected',userId:'u',roleId:'java-backend',runId:'r',attemptId:'a',deadlineAt:1000},{now:()=>0,allowLive:true});
 gate.reserve('http-1',{inputTokens:100,outputTokens:30});gate.dispatch('http-1');gate.rejectHttp('http-1',429);
 let s=gate.snapshot();expect(s.entries[0]?.status).toBe('rejected');expect(s.entries[0]?.rejectionStatus).toBe(429);expect(s.totals.activeSlots).toBe(0);
 expect(s.totals.heldTokens).toBe(130);expect(s.totals.usedTokens).toBe(0);expect(s.totals.callsConsumed).toBe(1);
 gate.reserve('http-2',{inputTokens:100,outputTokens:30});gate.dispatch('http-2');gate.settle('http-2',{inputTokens:10,outputTokens:2,complete:true});
 gate.settle('http-1',{inputTokens:0,outputTokens:0,complete:true});s=gate.snapshot();expect(s.totals.heldTokens).toBe(0);expect(s.totals.usedTokens).toBe(12);
 expect(()=>gate.rejectHttp('http-2',503)).toThrow('MODEL_STATE_CONFLICT');
});
