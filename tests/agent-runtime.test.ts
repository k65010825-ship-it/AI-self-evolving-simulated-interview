import{runtimeRequest}from'./helpers/runtime-request.ts';
import{test,expect}from'bun:test';
import{createRunManager}from'../apps/agent/src/runtime/run-manager.ts';
const output=()=>({evidence:[{id:'e',start:0,end:4,excerpt:'事务边界'}],criterionScores:[{criterionId:'correctness',score:1,evidenceIds:['e']}],
 feedback:{strengths:['已提及边界'],improvements:['补充失败条件']}});
test('runtime emits ordered typed events and returns uncommitted proposal with pinned next selection',async()=>{
 const manager=createRunManager({evaluateForRole:()=>async()=>output()});
 manager.start(runtimeRequest());await manager.wait('run-1');const snapshot=manager.snapshot('run-1');
 expect(snapshot.status).toBe('completed');expect(snapshot.result?.kind).toBe('uncommitted-turn-result');
 if(snapshot.result?.kind!=='uncommitted-turn-result'||snapshot.result.selection.status!=='selected')throw new Error('Expected selected proposal');
 expect(snapshot.result.selection.question.skillId).toBe('java-concurrency');
 const events=[];for await(const event of manager.events('run-1',0))events.push(event);
 expect(events.map(e=>e.seq)).toEqual(events.map((_,i)=>i+1));
 expect(events[0]?.type).toBe('run.accepted');expect(events.at(-1)?.type).toBe('run.completed');
 const question=events.find(e=>e.type==='question.completed');expect(JSON.stringify(question)).not.toContain('rubric');
 expect(JSON.stringify(events)).not.toContain('思维');manager.dispose();
});
test('same request retry does not reevaluate and changed payload or attempts conflict',async()=>{
 let calls=0;const manager=createRunManager({evaluateForRole:()=>async()=>{calls++;return output();}});const request=runtimeRequest();
 manager.start(request);manager.start(structuredClone(request));await manager.wait('run-1');manager.start(request);
 expect(calls).toBe(1);const changed=structuredClone(request);changed.job.input.answer.text='其他回答';
 expect(()=>manager.start(changed)).toThrow('VERSION_CONFLICT');
 const retry=structuredClone(request);retry.context.attemptId='attempt-2';retry.job.input.context.attemptId='attempt-2';
 expect(()=>manager.start(retry)).toThrow('VERSION_CONFLICT');manager.dispose();
});
test('cancel wins against a late provider and cannot reverse a completed run',async()=>{
 let finish!:(v:unknown)=>void, entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
 const manager=createRunManager({evaluateForRole:()=>async()=>new Promise(resolve=>{finish=resolve;entered();})});
 manager.start(runtimeRequest());await started;
 manager.cancel('run-1','attempt-1');finish(output());await manager.wait('run-1');
 expect(manager.snapshot('run-1').status).toBe('cancelled');expect(manager.snapshot('run-1').result).toBeNull();
 const fast=createRunManager({evaluateForRole:()=>async()=>output()});fast.start(runtimeRequest());await fast.wait('run-1');
 expect(fast.cancel('run-1','attempt-1').status).toBe('completed');manager.dispose();fast.dispose();
});
test('hung work times out, hiding dependency internals, and cursor/attempt checks stay strict',async()=>{
 const manager=createRunManager({evaluateForRole:()=>async()=>new Promise(()=>{})},{timeoutMs:5});manager.start(runtimeRequest());await manager.wait('run-1');
 expect(manager.snapshot('run-1').status).toBe('failed');expect(manager.snapshot('run-1').error?.code).toBe('DEADLINE_EXCEEDED');
 expect(()=>manager.cancel('run-1','old')).toThrow('VERSION_CONFLICT');
 await expect((async()=>{for await(const _ of manager.events('run-1',999)){} })()).rejects.toThrow('VERSION_CONFLICT');manager.dispose();
});
test('subscriber abort does not cancel work and retained results do not expose mutable internals',async()=>{
 const manager=createRunManager({evaluateForRole:()=>async()=>output()});manager.start(runtimeRequest());
 const controller=new AbortController();const iterator=manager.events('run-1',0,controller.signal)[Symbol.asyncIterator]();
 await iterator.next();controller.abort();await iterator.return?.(undefined);await manager.wait('run-1');
 const snapshot=manager.snapshot('run-1');snapshot.status='failed';expect(manager.snapshot('run-1').status).toBe('completed');manager.dispose();
});
test('capacity, deadline and mismatched host contexts fail without accepting fake work',async()=>{
 const manager=createRunManager({evaluateForRole:()=>async()=>output()},{maxRuns:1});manager.start(runtimeRequest());await manager.wait('run-1');
 expect(()=>manager.start(runtimeRequest('run-2'))).toThrow('RATE_LIMITED');
 const wrong=runtimeRequest('run-3');wrong.job.input.context={...wrong.context,userId:'other'};
 const fresh=createRunManager({evaluateForRole:()=>async()=>output()});expect(()=>fresh.start(wrong)).toThrow('VALIDATION_ERROR');
 const expired=runtimeRequest('expired');expired.context.deadlineAt=1;expired.job.input.context=expired.context;
 expect(()=>fresh.start(expired)).toThrow('DEADLINE_EXCEEDED');manager.dispose();fresh.dispose();
});

test('active capacity and disposal stop work while raw provider failures stay private',async()=>{
 const manager=createRunManager({evaluateForRole:()=>async()=>new Promise(()=>{})},{maxActiveRuns:1});
 manager.start(runtimeRequest());expect(()=>manager.start(runtimeRequest('second'))).toThrow('RATE_LIMITED');
 manager.dispose();await manager.wait('run-1');expect(manager.snapshot('run-1').status).toBe('cancelled');
 expect(()=>manager.start(runtimeRequest('after-dispose'))).toThrow('DEPENDENCY_UNAVAILABLE');
 const failed=createRunManager({evaluateForRole:()=>async()=>{throw new Error('secret-provider-detail');}});
 failed.start(runtimeRequest());await failed.wait('run-1');const snapshot=failed.snapshot('run-1');
 expect(snapshot.status).toBe('failed');expect(JSON.stringify(snapshot)).not.toContain('secret-provider-detail');failed.dispose();
});
