import{test,expect}from'bun:test';
import{runWorkflowRsiDemo}from'../scripts/demo-workflow-rsi.ts';
import{createRunManager}from'../apps/agent/src/runtime/run-manager.ts';
import{createAgentApp}from'../apps/agent/src/app.ts';
import type{AgentRunRequest}from'../packages/contracts/src/agent-run.ts';
const token='rsi-local-internal-service-token-123456789';
const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
async function fixture(){const d=await runWorkflowRsiDemo();const request:AgentRunRequest={inputSnapshotId:'rsi-source',context:{...d.source.identity,runId:'rsi-test',attemptId:'a',deadlineAt:Date.now()+60000},job:{type:'rsi',input:d.input}};
 const runtime=createRunManager({evaluateForRole:()=>async()=>({})}),app=createAgentApp({runtime,internalToken:token});return{d,request,runtime,app};}
test('RSI transport binds source identity and exposes only synthetic aggregate metadata',async()=>{
 const f=await fixture(),wrong=structuredClone(f.request);wrong.context.userId='other';
 expect((await f.app.request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(wrong)})).status).toBe(422);
 expect((await f.app.request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(f.request)})).status).toBe(202);
 await f.runtime.wait(f.request.context.runId);
 const response=await f.app.request(`/internal/v1/runs/${f.request.context.runId}/events`,{headers});const text=await response.text();
 expect(text).toContain('event: rsi.completed');expect(text).toContain('"evidenceMode":"synthetic"');expect(text).toContain('"productionPublished":false');
 expect(text).not.toContain('validation-depth-a');expect(text).not.toContain('baselinePolicy');f.runtime.dispose();
});
test('stale RSI registry fails after acceptance without publishing improvement or mutating source',async()=>{
 const f=await fixture();if(f.request.job.type!=='rsi')throw new Error('Expected RSI');f.request.job.input.expectedRegistryVersion=99;
 await f.app.request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(f.request)});await f.runtime.wait(f.request.context.runId);
 const run=f.runtime.snapshot(f.request.context.runId);expect(run.error?.code).toBe('VERSION_CONFLICT');expect(run.result).toBeNull();
 const events=[];for await(const e of f.runtime.events(f.request.context.runId))events.push(e.type);
 expect(events).not.toContain('rsi.completed');expect(f.d.input.registry.version).toBe(0);f.runtime.dispose();
});
test('cancelled RSI work does not emit a late successful evaluation event',async()=>{
 const f=await fixture();f.runtime.start(f.request);const iterator=f.runtime.events(f.request.context.runId)[Symbol.asyncIterator]();
 await iterator.next();await iterator.next();f.runtime.cancel(f.request.context.runId,'a');await f.runtime.wait(f.request.context.runId);await iterator.return?.(undefined);
 const run=f.runtime.snapshot(f.request.context.runId);expect(run.status).toBe('cancelled');expect(run.result).toBeNull();
 const events=[];for await(const e of f.runtime.events(f.request.context.runId))events.push(e.type);expect(events).not.toContain('rsi.completed');f.runtime.dispose();
});
