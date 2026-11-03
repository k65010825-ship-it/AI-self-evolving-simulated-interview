import{test,expect}from'bun:test';
import{createAgentClient}from'../packages/agent-client/src/index.ts';
import{createAgentApp}from'../apps/agent/src/app.ts';
import{createRunManager}from'../apps/agent/src/runtime/run-manager.ts';
import{toProblem}from'../packages/contracts/src/errors.ts';
import{runtimeRequest}from'./helpers/runtime-request.ts';
import{AgentRunRequestSchema}from'../packages/contracts/src/agent-run.ts';
const token='client-local-internal-service-token-123456';
function body(){const now=Date.now(),identity={userId:'u',roleId:'java-backend' as const};return{inputSnapshotId:'sdk-create',
 context:{...identity,runId:'client-create',attemptId:'a1',deadlineAt:now+60000},job:{type:'workflow' as const,operation:{action:'create' as const,
  config:{identity,session:{sessionId:'sdk-session',roleId:identity.roleId,durationMinutes:20,skills:[{skillId:'project-design',relevance:1}]},
   policy:{id:'pin',roleId:identity.roleId,parameters:{maxFollowupDepth:0,maxTurns:2,wrapUpSeconds:30}},goal:'客户端联调',skillLabels:{'project-design':'项目'},allowDraftKnowledge:true,now}}}};}
test('backend client executes a typed workflow task without mistaking acceptance for formal commit',async()=>{
 const runtime=createRunManager({evaluateForRole:()=>async()=>({})}),app=createAgentApp({runtime,internalToken:token});
 const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async(url,init)=>app.request(new Request(url,init))});
 const result=await client.executeRun(body());expect(result.status).toBe('completed');expect(result.result?.kind).toBe('uncommitted-workflow-result');runtime.dispose();
});

test('known HTTP errors retain static code/status/request ID without leaking upstream details or credentials',async()=>{
 const problem={...toProblem('VERSION_CONFLICT','trace-123'),detail:`private ${token}`};
 const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async()=>new Response(JSON.stringify(problem),{status:409,headers:{'content-type':'application/problem+json'}})});
 try{await client.getRun('r');throw new Error('Expected failure');}catch(error){
  expect(error).toMatchObject({code:'VERSION_CONFLICT',status:409,requestId:'trace-123'});expect(JSON.stringify(error)).not.toContain(token);expect(String(error)).not.toContain('private');
 }
});

test('unknown HTTP bodies and raw transport errors never escape through error messages',async()=>{
 for(const fetch of [async()=>new Response(`secret ${token}`,{status:502}),async()=>{throw new Error(`private ${token}`);}]){
  const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch});
  try{await client.getRun('r');throw new Error('Expected failure');}catch(error){expect(String(error)).not.toContain(token);expect(JSON.stringify(error)).not.toContain('private');}
 }
});

test('no POST auto-retry; pre-abort prevents fetch, ignored abort is bounded and late response is cancelled',async()=>{
 let calls=0;const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async()=>{calls++;throw new Error('offline');}});
 await expect(client.startRun(body())).rejects.toMatchObject({code:'NETWORK_ERROR'});expect(calls).toBe(1);
 const controller=new AbortController();controller.abort();await expect(client.getRun('r',{signal:controller.signal})).rejects.toMatchObject({code:'ABORTED'});expect(calls).toBe(1);
 let finish!:(r:Response)=>void,cancelled=false,closed!:()=>void;const cancelledBody=new Promise<void>(resolve=>{closed=resolve;});
 const slow=createAgentClient({baseUrl:'http://agent.local',internalToken:token,requestTimeoutMs:5,fetch:async()=>new Promise(resolve=>{finish=resolve;})});
 await expect(slow.getRun('r')).rejects.toMatchObject({code:'TIMEOUT'});
 finish(new Response(new ReadableStream<Uint8Array>({cancel(){cancelled=true;closed();}})));await cancelledBody;expect(cancelled).toBe(true);
});

test('snapshot schema, identity, content type and response size are validated',async()=>{
 const runtime=createRunManager({evaluateForRole:()=>async()=>({})}),request=body();runtime.start(request);await runtime.wait(request.context.runId);const snapshot=runtime.snapshot(request.context.runId);
 for(const response of [
  new Response(JSON.stringify({...snapshot,runId:'other'}),{headers:{'content-type':'application/json'}}),
  new Response(JSON.stringify({...snapshot,attemptId:'other'}),{headers:{'content-type':'application/json'}}),
  new Response(JSON.stringify(snapshot),{headers:{'content-type':'text/html'}}),
  new Response('{}',{headers:{'content-type':'application/json'}}),
 ]){const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async()=>response});
  await expect(client.getRun(request.context.runId,{attemptId:request.context.attemptId})).rejects.toMatchObject({code:'PROTOCOL_ERROR'});}
 const small=createAgentClient({baseUrl:'http://agent.local',internalToken:token,maxResponseBytes:4,fetch:async()=>new Response(JSON.stringify(snapshot),{headers:{'content-type':'application/json'}})});
 await expect(small.getRun(request.context.runId)).rejects.toMatchObject({code:'PROTOCOL_ERROR'});runtime.dispose();
});

test('unsafe base URLs/path identifiers are rejected and credentials are sent only with redirect blocked',async()=>{
 for(const baseUrl of ['file:///tmp','http://user:password@agent.local','http://agent.local/path','http://agent.local?query=1']){
  expect(()=>createAgentClient({baseUrl,internalToken:token})).toThrow();
 }
 const paths:string[]=[];const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async(url,init)=>{
  paths.push(url);expect(init?.redirect).toBe('error');expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`);
  return new Response(JSON.stringify(toProblem('NOT_FOUND','trace')),{status:404});}});
 await expect(client.getRun('..')).rejects.toMatchObject({code:'CLIENT_VALIDATION'});expect(paths).toEqual([]);
 await expect(client.getRun('a/b?#中文')).rejects.toMatchObject({code:'NOT_FOUND'});expect(paths[0]).toContain('a%2Fb%3F%23');
});

test('explicit remote cancellation uses expected attempt, while cancelled terminal is not a successful execute',async()=>{
 const runtime=createRunManager({evaluateForRole:()=>async()=>new Promise(()=>{})}),app=createAgentApp({runtime,internalToken:token});
 const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async(url,init)=>app.request(new Request(url,init))});
 const request=AgentRunRequestSchema.parse(runtimeRequest('client-cancel'));await client.startRun(request);
 await expect(client.cancelRun(request.context.runId,'old')).rejects.toMatchObject({code:'VERSION_CONFLICT'});
 const result=await client.cancelRun(request.context.runId,request.context.attemptId);expect(result.status).toBe('cancelled');
 await expect(client.waitForRun(request.context.runId,{attemptId:request.context.attemptId})).rejects.toMatchObject({code:'RUN_CANCELLED'});runtime.dispose();
});

test('execute validates all options before POST and its total budget includes delayed acceptance',async()=>{
 const runtime=createRunManager({evaluateForRole:()=>async()=>({})}),request=body();runtime.start(request);await runtime.wait(request.context.runId);
 const result=runtime.snapshot(request.context.runId);let posts=0;
 const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async(_url,init)=>{
  if(init?.method==='POST'){posts++;await new Promise(resolve=>setTimeout(resolve,30));}
  return new Response(JSON.stringify(result),{status:init?.method==='POST'?202:200,headers:{'content-type':'application/json'}});
 }});
 await expect(client.executeRun(request,{timeoutMs:0})).rejects.toMatchObject({code:'CLIENT_VALIDATION'});
 await expect(client.executeRun(request,{maxReconnects:99})).rejects.toMatchObject({code:'CLIENT_VALIDATION'});expect(posts).toBe(0);
 await expect(client.executeRun(request,{timeoutMs:5})).rejects.toMatchObject({code:'TIMEOUT'});expect(posts).toBe(1);runtime.dispose();
});

test('executeRun surfaces a workflow failure that occurs after HTTP acceptance',async()=>{
 const runtime=createRunManager({evaluateForRole:()=>async()=>({})}),app=createAgentApp({runtime,internalToken:token});
 const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async(url,init)=>app.request(new Request(url,init))});
 const first=await client.executeRun(body());if(first.result?.kind!=='uncommitted-workflow-result')throw new Error('Expected created workflow');
 const snapshot=first.result.snapshot,context={...body().context,runId:'bad-revision'};
 await expect(client.executeRun({inputSnapshotId:'bad-revision',context,job:{type:'workflow',operation:{action:'plan',snapshot,
  command:{identity:snapshot.identity,expectedRevision:99,context}}}})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
 expect(runtime.snapshot(context.runId).status).toBe('failed');runtime.dispose();
});
