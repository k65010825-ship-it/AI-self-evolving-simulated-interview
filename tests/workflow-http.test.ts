import{test,expect}from'bun:test';
import{createAgentApp}from'../apps/agent/src/app.ts';
import{createOfflineRunManager}from'../apps/agent/src/runtime/offline-runtime.ts';
import{createRunManager}from'../apps/agent/src/runtime/run-manager.ts';
import{createInterviewWorkflow,planInterviewQuestion}from'../apps/agent/src/orchestration/session-workflow.ts';
import{createWorkflowFixture}from'../experiments/session/fixture.ts';
import type{PlannerResult}from'../packages/contracts/src/knowledge-planner.ts';
const token='workflow-local-internal-service-test-token';
const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
function request(){const now=Date.now(),identity={userId:'u',roleId:'java-backend'};
 return{inputSnapshotId:'workflow-create-snapshot',context:{...identity,runId:'workflow-create',attemptId:'a1',deadlineAt:now+60000},
  job:{type:'workflow',operation:{action:'create',config:{identity,session:{sessionId:'remote-session',roleId:'java-backend',durationMinutes:20,
   skills:[{skillId:'project-design',relevance:1}]},policy:{id:'remote-pin',roleId:'java-backend',parameters:{maxFollowupDepth:0,maxTurns:2,wrapUpSeconds:30}},
   goal:'内部HTTP会话',skillLabels:{'project-design':'项目'},allowDraftKnowledge:true,now}}}};
}
test('internal run accepts workflow creation and returns uncommitted candidate with minimal SSE update',async()=>{
 const runtime=await createOfflineRunManager({planning:'pi-knowledge'}),app=createAgentApp({runtime,internalToken:token}),body=request();
 const accepted=await app.request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(body)});expect(accepted.status).toBe(202);
 await runtime.wait(body.context.runId);const result=runtime.snapshot(body.context.runId).result;
 expect(result?.kind).toBe('uncommitted-workflow-result');
 if(result?.kind!=='uncommitted-workflow-result')throw new Error('Expected workflow result');
 expect(result.snapshot.phase).toBe('ready_to_plan');expect(result.snapshot.revision).toBe(0);
 const stream=await app.request(`/internal/v1/runs/${body.context.runId}/events`,{headers});const text=await stream.text();
 expect(text).toContain('event: workflow.updated');expect(text).not.toContain('baseMemory');expect(text).toContain('"committed":false');runtime.dispose();
});

function planRequest(){const base=request(),snapshot=createInterviewWorkflow(base.job.operation.config);
 return{...base,job:{type:'workflow',operation:{action:'plan',snapshot,
  command:{identity:snapshot.identity,expectedRevision:0,context:base.context}}}};
}

test('service auth, root identity and nested attempt bindings are rejected before accepting work',async()=>{
 const runtime=createRunManager({evaluateForRole:()=>async()=>({})}),app=createAgentApp({runtime,internalToken:token});
 expect((await app.request('/internal/v1/runs',{method:'POST',body:JSON.stringify(request())})).status).toBe(401);
 const wrong=request();wrong.context.userId='other';expect((await app.request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(wrong)})).status).toBe(422);
 const old=planRequest();old.job.operation.command.context={...old.context,attemptId:'old'};
 expect((await app.request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(old)})).status).toBe(422);
 const unknown=request();unknown.job.operation.action='unknown';
 expect((await app.request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(unknown)})).status).toBe(422);
 expect(()=>runtime.snapshot(wrong.context.runId)).toThrow('NOT_FOUND');runtime.dispose();
});

test('identical workflow run retries return one result, while changed inputs conflict',async()=>{
 const runtime=createRunManager({evaluateForRole:()=>async()=>({})}),app=createAgentApp({runtime,internalToken:token}),body=request();
 for(let i=0;i<2;i++)expect((await app.request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(body)})).status).toBe(202);
 await runtime.wait(body.context.runId);const changed=structuredClone(body);changed.job.operation.config.goal='更换目标';
 expect((await app.request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(changed)})).status).toBe(409);
 const events=[];for await(const event of runtime.events(body.context.runId))events.push(event);
 expect(events.filter(e=>e.type==='workflow.updated')).toHaveLength(1);expect(runtime.snapshot(body.context.runId).status).toBe('completed');runtime.dispose();
});

test('accepted stale commands and missing planner become failed runs instead of fake successful workflows',async()=>{
 let calls=0;const runtime=createRunManager({evaluateForRole:()=>async()=>({}),planForRole:()=>async()=>{calls++;throw new Error('not reached');}});
 const app=createAgentApp({runtime,internalToken:token}),stale=planRequest();stale.job.operation.command.expectedRevision=1;
 expect((await app.request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(stale)})).status).toBe(202);
 await runtime.wait(stale.context.runId);expect(runtime.snapshot(stale.context.runId).error?.code).toBe('VERSION_CONFLICT');expect(calls).toBe(0);runtime.dispose();
 const missing=createRunManager({evaluateForRole:()=>async()=>({})}),missingApp=createAgentApp({runtime:missing,internalToken:token}),body=planRequest();
 await missingApp.request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(body)});await missing.wait(body.context.runId);
 expect(missing.snapshot(body.context.runId).error?.code).toBe('DEPENDENCY_UNAVAILABLE');expect(missing.snapshot(body.context.runId).result).toBeNull();missing.dispose();
});

test('cancellation fences attempts and suppresses late workflow result and update',async()=>{
 const body=planRequest(),fixture=await createWorkflowFixture();
 const valid=await fixture.plan({state:body.job.operation.snapshot.state,context:body.context,goal:'fixture',askedQuestionIds:[],
  planningPolicy:body.job.operation.snapshot.policy,allowDraftKnowledge:true},new AbortController().signal);
 let finish!:(p:PlannerResult)=>void,enter!:()=>void;const started=new Promise<void>(r=>{enter=r;});
 const runtime=createRunManager({evaluateForRole:()=>async()=>({}),planForRole:()=>async()=>new Promise(r=>{finish=r;enter();})});
 const app=createAgentApp({runtime,internalToken:token});await app.request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(body)});await started;
 expect((await app.request(`/internal/v1/runs/${body.context.runId}/cancellation`,{method:'POST',headers,body:JSON.stringify({attemptId:'old'})})).status).toBe(409);
 expect((await app.request(`/internal/v1/runs/${body.context.runId}/cancellation`,{method:'POST',headers,body:JSON.stringify({attemptId:'a1'})})).status).toBe(202);
 finish(valid);await runtime.wait(body.context.runId);expect(runtime.snapshot(body.context.runId).status).toBe('cancelled');expect(runtime.snapshot(body.context.runId).result).toBeNull();
 const events=[];for await(const event of runtime.events(body.context.runId))events.push(event.type);expect(events).not.toContain('workflow.updated');runtime.dispose();
});

test('hung workflow is bounded by run deadline, not a background candidate completion',async()=>{
 const runtime=createRunManager({evaluateForRole:()=>async()=>({}),planForRole:()=>async()=>new Promise(()=>{})},{timeoutMs:10});
 const app=createAgentApp({runtime,internalToken:token}),body=planRequest();await app.request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(body)});
 await runtime.wait(body.context.runId);expect(runtime.snapshot(body.context.runId).error?.code).toBe('DEADLINE_EXCEEDED');expect(runtime.snapshot(body.context.runId).result).toBeNull();runtime.dispose();
});

test('every remote operation revalidates pending receipt binding and create timestamps',async()=>{
 const body=planRequest(),fixture=await createWorkflowFixture();
 const planned=await planInterviewQuestion(body.job.operation.snapshot,body.job.operation.command,fixture);
 planned.current!.question.text='篡改的题目';planned.lastPlan!.selection=planned.current!;
 const runtime=createRunManager({evaluateForRole:()=>async()=>({})}),app=createAgentApp({runtime,internalToken:token});
 const restore={...body,job:{type:'workflow',operation:{action:'restore',snapshot:planned}}};
 // New content binds the question already at HTTP admission; no run is created.
 expect((await app.request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(restore)})).status).toBe(422);
 expect(()=>runtime.snapshot(body.context.runId)).toThrow('NOT_FOUND');
 // Legacy snapshots still need the runtime receipt validation, rather than bypassing it.
 for(const issued of planned.issuedQuestions)delete issued.content;
 expect((await app.request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(restore)})).status).toBe(202);
 await runtime.wait(body.context.runId);
 expect(runtime.snapshot(body.context.runId).error?.code).toBe('VALIDATION_ERROR');runtime.dispose();
 const future=request();future.job.operation.config.now=Date.now()+100000;
 const clock=createRunManager({evaluateForRole:()=>async()=>({})});clock.start(future);await clock.wait(future.context.runId);
 expect(clock.snapshot(future.context.runId).error?.code).toBe('VALIDATION_ERROR');clock.dispose();
});

test('host wrapup succeeds without a planner when no model work is needed',async()=>{
 const body=planRequest();body.job.operation.snapshot.state.deadlineAt=Date.now()+1000;
 const runtime=createRunManager({evaluateForRole:()=>async()=>({})}),app=createAgentApp({runtime,internalToken:token});
 await app.request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(body)});await runtime.wait(body.context.runId);
 const result=runtime.snapshot(body.context.runId).result;expect(result?.kind).toBe('uncommitted-workflow-result');
 if(result?.kind==='uncommitted-workflow-result')expect(result.snapshot.pendingReason).toBe('plan_finished');runtime.dispose();
});

test('workflow event cursors replay correctly and transport remains limited to two MiB',async()=>{
 const runtime=createRunManager({evaluateForRole:()=>async()=>({})}),app=createAgentApp({runtime,internalToken:token}),body=request();runtime.start(body);await runtime.wait(body.context.runId);
 const last=runtime.snapshot(body.context.runId).lastEventSeq;
 const replay=await app.request(`/internal/v1/runs/${body.context.runId}/events`,{headers:{...headers,'last-event-id':String(last-1)}});
 const text=await replay.text();expect(text).toContain('event: run.completed');expect(text).not.toContain('event: workflow.updated');
 expect((await app.request(`/internal/v1/runs/${body.context.runId}/events?afterSeq=${last+1}`,{headers})).status).toBe(409);
 expect((await app.request('/internal/v1/runs',{method:'POST',headers,body:' '.repeat(2*1024*1024)+JSON.stringify(body)})).status).toBe(413);runtime.dispose();
});
