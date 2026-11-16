import{test,expect}from'bun:test';
import{Database}from'bun:sqlite';
import{createDurableLiveRunManager}from'../apps/agent/src/runtime/durable-runtime.ts';
import config from'../apps/agent/src/model-access/bailian.example.json'with{type:'json'};
import{runtimeRequest}from'./helpers/runtime-request.ts';
import{mkdtempSync,readdirSync,unlinkSync,rmdirSync}from'node:fs';import{join}from'node:path';
test('real subprocess exit after dispatch leaves a durable unknown and never automatically repeats the charged attempt',async()=>{
 const dir=mkdtempSync(join(process.cwd(),'.cache','durable-crash-')),path=join(dir,'crash.sqlite'),req=runtimeRequest('durable-crash');
 const c={...config,authorization:{...config.authorization,enabled:true,operatorApproved:true,expiresAt:Date.now()+60000}};
 const code=`import{createDurableLiveRunManager}from'./apps/agent/src/runtime/durable-runtime.ts';
 const r=createDurableLiveRunManager(${JSON.stringify(c)},{readCredential:()=> 'synthetic-only',fetch:async()=>{process.exit(23);}},{path:${JSON.stringify(path)},ownerId:'child',leaseMs:10000});
 r.start(${JSON.stringify(req)});await r.wait(${JSON.stringify(req.context.runId)});process.exit(99);`;
 let r:ReturnType<typeof createDurableLiveRunManager>|undefined;
 try{
  const child=Bun.spawn([process.execPath,'--eval',code],{cwd:process.cwd(),stdout:'pipe',stderr:'pipe'});expect(await child.exited).toBe(23);
  let calls=0,keys=0;const now=Date.now()+15000;r=createDurableLiveRunManager(c,{now:()=>now,readCredential:()=>{keys++;return 'synthetic-only';},fetch:async()=>{calls++;throw Error('must not repeat');}},{path,ownerId:'parent'});
  expect(r.durableTasks(req.context.runId)?.status).toBe('interrupted');expect(r.start(req).status).toBe('failed');
  const s=r.modelAccounting()[0]!;expect(s.entries[0]?.status).toBe('unknown');expect(s.totals.heldTokens).toBeGreaterThan(0);
  expect(()=>r!.start(runtimeRequest('new-while-unknown'))).toThrow('DEPENDENCY_UNAVAILABLE');expect(keys).toBe(0);expect(calls).toBe(0);
  r.reconcile({runId:req.context.runId,attemptId:req.context.attemptId,identity:{userId:req.context.userId,roleId:req.context.roleId},expectedVersion:s.version,
   callId:s.entries[0]!.callId,usage:{inputTokens:100,outputTokens:30,complete:true},evidenceRef:'synthetic-external-usage'});
  expect(r.modelAccounting()[0]!.totals.usedTokens).toBe(130);expect(r.start(req).status).toBe('failed');expect(calls).toBe(0);
 }finally{r?.close();for(const n of readdirSync(dir))unlinkSync(join(dir,n));rmdirSync(dir);}
},15000);
test('actual SQLite budget write failure stops before HTTP dispatch',async()=>{
 const dir=mkdtempSync(join(process.cwd(),'.cache','durable-sql-fail-')),path=join(dir,'a.sqlite');let calls=0;
 const c={...config,authorization:{...config.authorization,enabled:true,operatorApproved:true,expiresAt:Date.now()+60000}};
 const r=createDurableLiveRunManager(c,{readCredential:()=> 'synthetic-only',fetch:async()=>{calls++;throw Error('must not send');}},{path,ownerId:'one'});
 const db=new Database(path);db.exec("CREATE TRIGGER fail_budget BEFORE INSERT ON agent_budgets BEGIN SELECT RAISE(ABORT,'synthetic-disk-failure'); END;");
 try{const req=runtimeRequest('sqlite-write-failure');r.start(req);await r.wait(req.context.runId);expect(r.snapshot(req.context.runId).status).toBe('failed');expect(calls).toBe(0);expect(r.modelAccounting()).toEqual([]);}
 finally{db.close();r.close();for(const n of readdirSync(dir))unlinkSync(join(dir,n));rmdirSync(dir);}
});
