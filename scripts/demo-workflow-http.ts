import{randomBytes}from'node:crypto';
import{pathToFileURL}from'node:url';
import{createAgentApp}from'../apps/agent/src/app.ts';
import{createOfflineRunManager}from'../apps/agent/src/runtime/offline-runtime.ts';
import{AgentRunRequestSchema,AgentRunEventSchema,AgentRunSnapshotSchema,type AgentRunEvent,type AgentRunSnapshot}from'../packages/contracts/src/agent-run.ts';
import{createAgentClient}from'@interview/agent-client';
import type{WorkflowOperation}from'../packages/contracts/src/workflow-job.ts';
import type{InterviewWorkflow}from'../packages/contracts/src/session-workflow.ts';
import type{RoleId,ToolContext}from'../packages/contracts/src/tools.ts';

/** Defaults to real localhost TCP. In-process option keeps tutorial examples sandbox-independent. */
export async function runWorkflowHttpDemo(roleId:RoleId='java-backend',transport:'tcp'|'in-process'='tcp',options:{sdk?:boolean}={}){
 const runtime=await createOfflineRunManager({planning:'pi-knowledge'}),token=randomBytes(32).toString('hex');
 const app=createAgentApp({runtime,internalToken:token});
 const server=transport==='tcp'?Bun.serve({hostname:'127.0.0.1',port:0,fetch:app.fetch}):undefined;
 const request=(path:string,init:RequestInit={})=>server?fetch(`http://127.0.0.1:${server.port}${path}`,init):app.request(path,init);
 const headers={authorization:`Bearer ${token}`,'content-type':'application/json'},identity={userId:'http-fixture',roleId};
 const client=options.sdk?createAgentClient({baseUrl:server?`http://127.0.0.1:${server.port}`:'http://agent.local',internalToken:token,
  fetch:async(url,init)=>server?fetch(url,init):app.request(new Request(url,init))}):undefined;
 const phases:string[]=[],actions:string[]=[],revisionHistory:number[]=[];let count=0,eventCount=0,questionCount=0;
 async function invoke(build:(context:ToolContext)=>WorkflowOperation):Promise<InterviewWorkflow>{
  const context={...identity,runId:`workflow-${roleId}-${++count}`,attemptId:'a1',deadlineAt:Date.now()+60000},operation=build(context);
  const body=AgentRunRequestSchema.parse({inputSnapshotId:`input-${roleId}-${count}`,context,job:{type:'workflow',operation}});
  const events:AgentRunEvent[]=[];let run:AgentRunSnapshot;
  if(client){
   await client.startRun(body);
   for await(const event of client.events(context.runId,{attemptId:context.attemptId}))events.push(event);
   run=await client.getRun(context.runId,{attemptId:context.attemptId});
  }else{
   const accepted=await request('/internal/v1/runs',{method:'POST',headers,body:JSON.stringify(body)});
   if(accepted.status!==202)throw new Error(`Workflow HTTP rejected ${accepted.status}`);await accepted.json();
   const stream=await request(`/internal/v1/runs/${context.runId}/events`,{headers});if(!stream.ok)throw new Error('Workflow SSE rejected');
   const text=await stream.text();events.push(...text.split('\n').filter(line=>line.startsWith('data:')).map(line=>AgentRunEventSchema.parse(JSON.parse(line.slice(5).trim()))));
   const response=await request(`/internal/v1/runs/${context.runId}`,{headers});run=AgentRunSnapshotSchema.parse(await response.json());
  }
  const text=JSON.stringify(events);if(text.includes('baseMemory')||text.includes('criterionScores')||text.includes('rubric'))throw new Error('Private data in SSE');
  if(events.filter(e=>e.type==='workflow.updated').length!==1||events.at(-1)?.type!=='run.completed')throw new Error('Missing workflow completion');
  eventCount+=events.length;questionCount+=events.filter(e=>e.type==='question.completed').length;
  if(run.result?.kind!=='uncommitted-workflow-result')throw new Error(`Workflow task failed ${run.error?.code}`);
  const snapshot=run.result.snapshot;phases.push(snapshot.phase);actions.push(operation.action);revisionHistory.push(snapshot.revision);return snapshot;
 }
 try{
  let snapshot=await invoke(()=>({action:'create',config:{identity,session:{sessionId:`remote-${roleId}`,roleId,durationMinutes:20,
   skills:[{skillId:'project-design',relevance:1},{skillId:'collaboration',relevance:.99}]},
   policy:{id:'remote-policy-v1',roleId,parameters:{maxFollowupDepth:0,maxTurns:2,wrapUpSeconds:30}},
   goal:'HTTP完整会话演示',skillLabels:{'project-design':'项目论证',collaboration:'协作叙述'},allowDraftKnowledge:true,now:Date.now()}}));
  for(let i=0;i<2;i++){
   snapshot=await invoke(context=>({action:'plan',snapshot,command:{identity,expectedRevision:snapshot.revision,context}}));
   snapshot=await invoke(context=>({action:'answer',snapshot,command:{identity,expectedRevision:snapshot.revision,context,
    observationId:`observation-${i}`,answer:{id:`answer-${i}`,text:i===0?'我负责项目边界与验证，尚未验证生产效果。':'以下是假设协作案例，先确认影响，再协商动作和验收。'},
    quality:.8,evidenceMode:'offline-fixture'}}));
  }
  const finish={identity,expectedRevision:snapshot.revision,mode:'automatic' as const,sourceGroupId:`remote-fixture-${roleId}`};
  snapshot=await invoke(()=>({action:'finish',snapshot,command:finish}));
  const frozen=JSON.stringify(snapshot);snapshot=await invoke(()=>({action:'finish',snapshot,command:finish}));
  if(JSON.stringify(snapshot)!==frozen)throw new Error('Retry changed workflow');
  snapshot=await invoke(()=>({action:'restore',snapshot}));
  return{roleId,transport,client:client?'sdk':'manual-fetch',actions,phases,revisionHistory,eventCount,questionCount,phase:snapshot.phase,
   sessionVersion:snapshot.state.version,revision:snapshot.revision,memoryVersion:snapshot.closeout!.memoryCandidate.version,
   reportScope:snapshot.closeout!.report.scope,liveModelCalls:0,committed:false};
 }finally{runtime.dispose();await server?.stop(true);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 for(const role of ['java-backend','web-frontend']as const)console.log(JSON.stringify(await runWorkflowHttpDemo(role),null,2));
}
