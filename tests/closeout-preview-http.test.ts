import {expect,test} from 'bun:test';
import {runSessionWorkflowDemo} from '../scripts/demo-session-workflow.ts';
import {createFeedbackRevisionHistory,proposeFeedbackRevision} from '../packages/interview-domain/src/feedback-revision.ts';
import {closeoutSnapshotDigest} from '../apps/agent/src/reporting/closeout-preview.ts';
import {createRunManager} from '../apps/agent/src/runtime/run-manager.ts';
import {createAgentApp} from '../apps/agent/src/app.ts';
import {createAgentClient} from '../packages/agent-client/src/index.ts';
import {createWorkflowCommitTicket} from '../packages/agent-client/src/workflow-commit.ts';
import type {AgentRunRequest} from '../packages/contracts/src/agent-run.ts';
const token='closeout-preview-offline-token-123456';
for(const roleId of ['java-backend','web-frontend'] as const)test(roleId+': readonly preview traverses TCP/SSE, never allocates model dependencies or admits a formal commit',async()=>{
 const snapshot=(await runSessionWorkflowDemo(roleId)).session,t=snapshot.turns[0]!,now=Date.now(),identity=snapshot.identity;
 let history=createFeedbackRevisionHistory(t.input,t.proposal);history=proposeFeedbackRevision(t.input,t.proposal,history,
  {requestId:'edit',expectedVersion:0,expectedHeadDigest:history.headSourceDigest,feedback:{strengths:[],improvements:['仅离线预览，不是正式报告']},note:'synthetic test'},
  {...identity,sessionId:snapshot.state.sessionId,editorId:'synthetic-editor',authorizedEditorIds:['synthetic-editor'],now}).history;
 let modelFactories=0;
 const runtime=createRunManager({evaluateForRole:()=>{modelFactories++;throw Error('must not allocate');},forRun:()=>{modelFactories++;throw Error('must not allocate');},
  planForRole:()=>{modelFactories++;throw Error('must not allocate');},deliverForRole:()=>{modelFactories++;throw Error('must not allocate');},previewEditorsFor:()=>['synthetic-editor']});
 const app=createAgentApp({runtime,internalToken:token}),server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:app.fetch});
 try{
  const request:AgentRunRequest={inputSnapshotId:'preview-'+roleId,context:{...identity,runId:'preview-'+roleId,attemptId:'a',deadlineAt:Date.now()+60000},
   job:{type:'closeout-preview',input:{snapshot,expectedSnapshotDigest:closeoutSnapshotDigest(snapshot),selections:[{answerId:t.input.answer.id,history,version:1}]}}};
  const client=createAgentClient({baseUrl:`http://127.0.0.1:${server.port}`,internalToken:token});
  const result=await client.executeRun(request);expect(result.status).toBe('completed');if(result.result?.kind!=='uncommitted-closeout-preview')throw Error('kind');
  expect(result.result.report.assessments[0]!.feedback.improvements).toEqual(['仅离线预览，不是正式报告']);expect(result.result.formalCommitted).toBe(false);expect(modelFactories).toBe(0);
  const events=[];for await(const e of client.events(request.context.runId,{attemptId:'a'}))events.push(e);
  expect(events.some(e=>e.type==='run.completed'&&e.payload.resultKind==='uncommitted-closeout-preview')).toBe(true);
  expect(JSON.stringify(events)).not.toContain('仅离线预览，不是正式报告');
  expect(()=>createWorkflowCommitTicket({identity,request,operationId:'op',taskId:'task',leaseVersion:1,expectedStorageVersion:1,expectedMemoryVersion:1,issuedAt:now,leaseUntil:Date.now()+60000})).toThrow('COMMIT_UNSUPPORTED_JOB');
  expect(runtime.start(request).runId).toBe(result.runId);expect(modelFactories).toBe(0);
  const forged=createAgentClient({baseUrl:`http://127.0.0.1:${server.port}`,internalToken:token,fetch:async(url,init)=>{
   const response=await fetch(url,init);
   if((init?.method??'GET')==='GET'&&new URL(url).pathname===`/internal/v1/runs/${request.context.runId}`){
    const body=await response.json() as {result:{basedOn:{reportDigest:string}}};body.result.basedOn.reportDigest='0'.repeat(64);return Response.json(body);
   }return response;
  }});
  await expect(forged.executeRun(request)).rejects.toMatchObject({code:'PROTOCOL_ERROR'});
 }finally{runtime.dispose();server.stop(true);}
},30000);
