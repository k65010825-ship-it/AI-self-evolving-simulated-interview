import{test,expect}from'bun:test';
import{createRunManager}from'../apps/agent/src/runtime/run-manager.ts';
import{createAgentApp}from'../apps/agent/src/app.ts';
import{createAgentClient}from'../packages/agent-client/src/index.ts';
import{AgentRunRequestSchema}from'../packages/contracts/src/agent-run.ts';
import{fixtureAssessment}from'../experiments/pi-sdk/evaluation-fixture.ts';
import{runtimeRequest}from'./helpers/runtime-request.ts';
test('backend consumes delivery through actual HTTP/SSE and rejects quotes unrelated to the requested answer',async()=>{
 for(const corrupt of [false,true]){
  let release!:(v:unknown)=>void;const gate=new Promise<unknown>(resolve=>{release=resolve;});
  const runtime=createRunManager({evaluateForRole:()=>async()=>fixtureAssessment,forRun:()=>({evaluate:async()=>fixtureAssessment,deliver:async()=>gate})});
  const token='delivery_test_service_token_1234567890',paths:string[]=[];let frames:Promise<string>|undefined;
  try{
   const app=createAgentApp({runtime,internalToken:token}),request=AgentRunRequestSchema.parse(runtimeRequest('delivery-http-'+corrupt));
   const client=createAgentClient({baseUrl:'http://agent.local',internalToken:token,fetch:async(url,init)=>{
    const path=new URL(url).pathname;paths.push(path);const response=await app.request(new Request(url,init));
    if(path.endsWith('/events')){frames=response.clone().text();queueMicrotask(()=>release({bridge:'你刚才提到“事务边界”，我们继续往下看。',excerpt:'事务边界'}));}
    if(corrupt&&init?.method==='GET'&&!path.endsWith('/events')){
     const body=await response.clone().json();if(body.result?.delivery){const d=body.result.delivery;d.excerpt='not-in-answer';d.bridge='你提到not-in-answer，我们继续往下看。';d.text=d.bridge+'\n'+d.question.text;
      return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});}
    }return response;
   }});
   if(corrupt)await expect(client.executeRun(request)).rejects.toMatchObject({code:'PROTOCOL_ERROR'});
   else{const result=await client.executeRun(request);if(result.result?.kind!=='uncommitted-turn-result')throw Error('turn');expect(result.result.delivery?.status).toBe('generated');}
   expect(paths.some(p=>p.endsWith('/events'))).toBe(true);const sse=await frames;expect(sse).toContain('event: question.completed');expect(sse).toContain('uncommitted-question-delivery');
  }finally{release({});runtime.dispose();}
 }
});
test('cancelled delivery retains the actual pending generator and never emits a question success',async()=>{
 let entered!:()=>void,release!:(v:unknown)=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
 const runtime=createRunManager({evaluateForRole:()=>async()=>fixtureAssessment,forRun:()=>({evaluate:async()=>fixtureAssessment,deliver:async()=>{
  entered();return new Promise(resolve=>{release=resolve;});}})});
 try{const r=runtimeRequest('delivery-cancel');runtime.start(r);await started;runtime.cancel(r.context.runId,r.context.attemptId);await runtime.wait(r.context.runId);
  expect(runtime.snapshot(r.context.runId).status).toBe('cancelled');expect(runtime.diagnostics().inFlightDependencies).toBe(1);
  release({bridge:'你刚才提到事务边界。',excerpt:'事务边界'});await new Promise(resolve=>setTimeout(resolve,1));
  expect(runtime.diagnostics().inFlightDependencies).toBe(0);const events=[];for await(const e of runtime.events(r.context.runId))events.push(e);
  expect(events.some(e=>e.type==='question.completed')).toBe(false);
 }finally{runtime.dispose();}
});
