import{test,expect}from'bun:test';
import{openDurableStore}from'../apps/agent/src/runtime/durable-store.ts';
import{runtimeRequest}from'./helpers/runtime-request.ts';
import{createModelBudgetGate}from'../apps/agent/src/model-access/budget.ts';
import config from'../apps/agent/src/model-access/bailian.example.json'with{type:'json'};
import{mkdtempSync,readdirSync,unlinkSync,rmdirSync}from'node:fs';import{join}from'node:path';
import{createHash}from'node:crypto';
test('SQLite restart fences expired owner, preserves unknown holds and idempotently reconciles only trusted usage',()=>{
 const dir=mkdtempSync(join(process.cwd(),'.cache','durable-store-')),file=join(dir,'agent.sqlite');let now=Date.now();
 const request=runtimeRequest('persist-budget'),a=openDurableStore(file,{ownerId:'a',now:()=>now,leaseMs:1000});
 let b:ReturnType<typeof openDurableStore>|undefined;
 try{
  a.enqueue(request);const fence=a.claim(request.context.runId);
  const pseudo=(v:string)=>createHash('sha256').update(v).digest('hex').slice(0,40);
  const gate=createModelBudgetGate(config.profile,{budgetId:'b',userId:pseudo(request.context.userId),roleId:'java-backend',runId:pseudo(request.context.runId),attemptId:pseudo(request.context.attemptId),deadlineAt:request.context.deadlineAt},
   {allowLive:true,now:()=>now,onCheckpoint:s=>a.checkpointBudget(request.context.runId,fence,s,config.profile)});
  gate.reserve('http-1',{inputTokens:100,outputTokens:30});gate.dispatch('http-1');
  now+=1001;b=openDurableStore(file,{ownerId:'b',now:()=>now,leaseMs:1000});b.recoverExpired();
  expect(b.task(request.context.runId)?.status).toBe('interrupted');expect(b.accounting()[0]?.snapshot.entries[0]?.status).toBe('unknown');
  expect(()=>a.checkpointBudget(request.context.runId,fence,gate.snapshot(),config.profile)).toThrow('DURABLE_FENCED');expect(b.hasBlockedAccounting()).toBe(true);
  const snapshot=b.accounting()[0]!.snapshot,input={runId:request.context.runId,attemptId:request.context.attemptId,identity:{userId:request.context.userId,roleId:request.context.roleId},
   callId:'http-1',expectedVersion:snapshot.version,usage:{inputTokens:10,outputTokens:2,complete:true},evidenceRef:'synthetic-local-usage'};
  expect(()=>b!.reconcile({...input,identity:{...input.identity,userId:'other'}})).toThrow('DURABLE_FORBIDDEN');
  expect(b.reconcile(input).kind).toBe('reconciled');expect(b.reconcile(input).kind).toBe('replayed');
  expect(()=>b!.reconcile({...input,usage:{...input.usage,inputTokens:11}})).toThrow('DURABLE_RECONCILIATION_CONFLICT');expect(b.hasBlockedAccounting()).toBe(false);
  expect(b.accounting()[0]?.snapshot.totals.usedTokens).toBe(12);expect(b.task(request.context.runId)?.status).toBe('interrupted');
 }finally{a.close();b?.close();for(const name of readdirSync(dir))unlinkSync(join(dir,name));rmdirSync(dir);}
});
