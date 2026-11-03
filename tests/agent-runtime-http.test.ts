import{test,expect}from'bun:test';
import{createAgentApp}from'../apps/agent/src/app.ts';
import{createRunManager}from'../apps/agent/src/runtime/run-manager.ts';
import{runPiInterviewDemo}from'../scripts/demo-pi-interview.ts';
import{runtimeRequest}from'./helpers/runtime-request.ts';
const token='local-test-internal-service-token-123456';
async function fixture(){
 const d=await runPiInterviewDemo();const runtime=createRunManager({evaluateForRole:()=>async()=>({})});
 const app=createAgentApp({runtime,internalToken:token});
 const body={inputSnapshotId:'report-snapshot',context:{userId:'demo',runId:'report-run',attemptId:'a',roleId:'java-backend',deadlineAt:Date.now()+60000},
  job:{type:'report',input:d.reportInput}};
 const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
 return{app,runtime,body,headers};
}
test('configured internal HTTP requires explicit service authentication and returns real report snapshots',async()=>{
 const f=await fixture();expect((await f.app.request('/internal/v1/runs',{method:'POST',body:JSON.stringify(f.body)})).status).toBe(401);
 const accepted=await f.app.request('/internal/v1/runs',{method:'POST',headers:f.headers,body:JSON.stringify(f.body)});expect(accepted.status).toBe(202);
 await f.runtime.wait('report-run');const response=await f.app.request('/internal/v1/runs/report-run',{headers:f.headers});
 const snapshot=await response.json();expect(snapshot.status).toBe('completed');expect(snapshot.result.kind).toBe('uncommitted-report-result');f.runtime.dispose();
});
test('SSE replays strict internal product events with cursor validation and no fake formal commit',async()=>{
 const f=await fixture();f.runtime.start(f.body);await f.runtime.wait('report-run');
 const response=await f.app.request('/internal/v1/runs/report-run/events',{headers:f.headers});expect(response.headers.get('content-type')).toContain('text/event-stream');
 const text=await response.text();expect(text).toContain('event: run.completed');expect(text).toContain('"committed":false');expect(text).not.toContain('rubric');
 const bad=await f.app.request('/internal/v1/runs/report-run/events',{headers:{...f.headers,'last-event-id':'999'}});expect(bad.status).toBe(409);
 const malformed=await f.app.request('/internal/v1/runs/report-run/events?afterSeq=-1',{headers:f.headers});expect(malformed.status).toBe(422);f.runtime.dispose();
});
test('default scaffold stays unconfigured, malformed bodies are rejected and tokens never appear in errors',async()=>{
 expect((await createAgentApp().request('/internal/v1/runs',{method:'POST'})).status).toBe(501);
 const f=await fixture();const invalid=await f.app.request('/internal/v1/runs',{method:'POST',headers:f.headers,body:'{'});
 expect(invalid.status).toBe(422);expect(await invalid.text()).not.toContain(token);
 const unauth=await f.app.request('/internal/v1/runs',{method:'POST',headers:{...f.headers,authorization:'Bearer wrong'}});expect(unauth.status).toBe(401);f.runtime.dispose();
});

test('internal cancellation preserves attempt fencing and request size limits',async()=>{
 const runtime=createRunManager({evaluateForRole:()=>async()=>new Promise(()=>{})});
 expect(()=>createAgentApp({runtime})).toThrow('Explicit internal service token required');
 const app=createAgentApp({runtime,internalToken:token});
 const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
 runtime.start(runtimeRequest('cancel-http'));
 const old=await app.request('/internal/v1/runs/cancel-http/cancellation',{method:'POST',headers,body:JSON.stringify({attemptId:'old'})});
 expect(old.status).toBe(409);
 const cancelled=await app.request('/internal/v1/runs/cancel-http/cancellation',{method:'POST',headers,body:JSON.stringify({attemptId:'attempt-1'})});
 expect(cancelled.status).toBe(202);expect((await cancelled.json()).status).toBe('cancelled');await runtime.wait('cancel-http');
 const large=await app.request('/internal/v1/runs',{method:'POST',headers,body:'x'.repeat(2*1024*1024+1)});
 expect(large.status).toBe(413);runtime.dispose();
});

test('SSE sends accepted progress before evaluation finishes and then closes at terminal',async()=>{
 let finish!:(value:unknown)=>void,entered!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const runtime=createRunManager({evaluateForRole:()=>async()=>new Promise(resolve=>{finish=resolve;entered();})});
 const app=createAgentApp({runtime,internalToken:token});runtime.start(runtimeRequest('live-sse'));await started;
 const response=await app.request('/internal/v1/runs/live-sse/events',{headers:{authorization:`Bearer ${token}`}});
 const reader=response.body!.getReader(),decoder=new TextDecoder();
 try{
  const first=await reader.read();expect(decoder.decode(first.value)).toContain('event: run.accepted');
  expect(runtime.snapshot('live-sse').status).toBe('running');
  finish({evidence:[{id:'e',start:0,end:4,excerpt:'事务边界'}],criterionScores:[{criterionId:'correctness',score:1,evidenceIds:['e']}],
   feedback:{strengths:['已有边界'],improvements:['补充失败条件']}});
  let tail='';while(true){const chunk=await reader.read();if(chunk.done)break;tail+=decoder.decode(chunk.value);}
  expect(tail).toContain('event: run.completed');expect(runtime.snapshot('live-sse').status).toBe('completed');
 }finally{await reader.cancel();runtime.dispose();}
});
