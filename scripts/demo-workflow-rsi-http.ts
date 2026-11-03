import{randomBytes}from'node:crypto';
import{pathToFileURL}from'node:url';
import{createAgentClient}from'@interview/agent-client';
import{createAgentApp}from'../apps/agent/src/app.ts';
import{createOfflineRunManager}from'../apps/agent/src/runtime/offline-runtime.ts';
import{runWorkflowRsiDemo}from'./demo-workflow-rsi.ts';
import type{RoleId}from'../packages/contracts/src/tools.ts';
import type{AgentRunRequest}from'../packages/contracts/src/agent-run.ts';
export async function runWorkflowRsiHttpDemo(roleId:RoleId='java-backend',transport:'tcp'|'in-process'='tcp'){
 const source=await runWorkflowRsiDemo(roleId),runtime=await createOfflineRunManager(),token=randomBytes(32).toString('hex');
 const app=createAgentApp({runtime,internalToken:token}),server=transport==='tcp'?Bun.serve({hostname:'127.0.0.1',port:0,fetch:app.fetch}):undefined;
 const client=createAgentClient({baseUrl:server?`http://127.0.0.1:${server.port}`:'http://agent.local',internalToken:token,
  fetch:async(url,init)=>server?fetch(url,init):app.request(new Request(url,init))});
 try{
  const request:AgentRunRequest={inputSnapshotId:'rsi-input',context:{...source.source.identity,runId:`rsi-http-${roleId}`,attemptId:'a',deadlineAt:Date.now()+60000},
   job:{type:'rsi',input:source.input}};
  await client.startRun(request);const events=[];
  for await(const e of client.events(request.context.runId,{attemptId:'a'}))events.push(e);
  const text=JSON.stringify(events);if(text.includes('baselinePolicy')||text.includes('validation-depth-a')||text.includes('criterionScores'))throw new Error('Private RSI payload in SSE');
  const run=await client.getRun(request.context.runId,{attemptId:'a'});if(run.result?.kind!=='uncommitted-workflow-rsi')throw new Error('Expected RSI candidate');
  const result=run.result;
  const replay=await client.executeRun({inputSnapshotId:'rsi-replay',context:{...request.context,runId:`rsi-http-replay-${roleId}`},
   job:{type:'rsi',input:{...source.input,registry:result.registryCandidate,now:Date.now()}}});
  if(replay.result?.kind!=='uncommitted-workflow-rsi')throw new Error('Expected RSI replay');
  return{roleId,transport,status:result.status,metric:result.metric,baseline:result.evaluation?.baseline.value,candidate:result.evaluation?.candidate.value,
   delta:result.evaluation?.delta,eventTypes:events.map(e=>e.type),registryVersion:result.registryCandidate.version,replayStatus:replay.result.status,
   replayVersion:replay.result.registryCandidate.version,oldDepth:source.source.policy.parameters.maxFollowupDepth,
   previewDepth:result.nextSessionPin.policy.parameters.maxFollowupDepth,scope:result.scope,productionPublished:false,liveModelCalls:source.liveModelCalls};
 }finally{runtime.dispose();await server?.stop(true);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const role of ['java-backend','web-frontend']as const)console.log(JSON.stringify(await runWorkflowRsiHttpDemo(role),null,2));
}
