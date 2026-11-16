import {randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runSessionWorkflowDemo} from './demo-session-workflow.ts';
import {createRunManager} from '../apps/agent/src/runtime/run-manager.ts';
import {createAgentApp} from '../apps/agent/src/app.ts';
import {createAgentClient} from '../packages/agent-client/src/index.ts';
import {buildCloseoutPreview,closeoutSnapshotDigest} from '../apps/agent/src/reporting/closeout-preview.ts';
import {createFeedbackRevisionHistory,proposeFeedbackRevision} from '../packages/interview-domain/src/feedback-revision.ts';
import type {AgentRunRequest} from '../packages/contracts/src/agent-run.ts';
import type {RoleId} from '../packages/contracts/src/tools.ts';
import {contentHash} from '../evals/answers/validation.ts';
import {collectDeliverySources} from '../evals/delivery/sources.ts';

export async function runCloseoutPreviewDemo(roleId:RoleId='java-backend'){
 const snapshot=(await runSessionWorkflowDemo(roleId)).session,t=snapshot.turns[0]!,at=Date.now(),originalDigest=closeoutSnapshotDigest(snapshot);
 let history=createFeedbackRevisionHistory(t.input,t.proposal);
 history=proposeFeedbackRevision(t.input,t.proposal,history,{requestId:'preview-demo-edit',expectedVersion:0,expectedHeadDigest:history.headSourceDigest,
  feedback:{strengths:[],improvements:['在相同条件下补充验证步骤；此处是离线修订预览']},note:'AI-authored development fixture, not independent review'},
  {...snapshot.identity,sessionId:snapshot.state.sessionId,editorId:'synthetic-preview-editor',authorizedEditorIds:['synthetic-preview-editor'],now:at}).history;
 let modelFactories=0;const forbidden=():never=>{modelFactories++;throw Error('PREVIEW_MODEL_DEPENDENCY_FORBIDDEN');};
 const runtime=createRunManager({evaluateForRole:forbidden,forRun:forbidden,planForRole:forbidden,deliverForRole:forbidden,previewEditorsFor:()=>['synthetic-preview-editor']});
 const token=randomBytes(32).toString('hex'),app=createAgentApp({runtime,internalToken:token}),server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:app.fetch});
 try{
  const request:AgentRunRequest={inputSnapshotId:'preview-demo-'+roleId,context:{...snapshot.identity,runId:'preview-demo-'+roleId,attemptId:'a',deadlineAt:Date.now()+60000},
   job:{type:'closeout-preview',input:{snapshot,expectedSnapshotDigest:originalDigest,selections:[{answerId:t.input.answer.id,history,version:1}]}}};
  const client=createAgentClient({baseUrl:`http://127.0.0.1:${server.port}`,internalToken:token}),result=await client.executeRun(request);
  if(result.result?.kind!=='uncommitted-closeout-preview')throw Error('PREVIEW_DEMO_FAILED');
  const eventTypes=[];for await(const e of client.events(request.context.runId,{attemptId:'a'}))eventTypes.push(e.type);
  const originalUnchanged=closeoutSnapshotDigest(snapshot)===originalDigest;
  const direct=await buildCloseoutPreview(request.job.type==='closeout-preview'?request.job.input:undefined,request.context,{authorizedEditorIds:['synthetic-preview-editor']});
  if(contentHash(direct.report)!==contentHash(result.result.report)||!originalUnchanged||modelFactories!==0)throw Error('PREVIEW_DEMO_FAILED');
  return {roleId,request,preview:result.result,eventTypes,originalUnchanged,modelFactories,liveModelCalls:0,humanReferenceCount:0,qualityClaimEligible:false,formalCommitted:false};
 }finally{runtime.dispose();server.stop(true);}
}
export async function writeCloseoutPreviewDemo(){
 const rows=[];for(const role of ['java-backend','web-frontend']as const)rows.push(await runCloseoutPreviewDemo(role));
 const sourceManifest=await collectDeliverySources(process.cwd()),body={version:1,mode:'offline-synthetic-closeout-preview',rows,sourceManifest,liveModelCalls:0,humanReferenceCount:0,qualityClaimEligible:false,formalCommitted:false};
 const root=resolve('.cache/closeout-preview');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'run-'));
 const report={...body,digest:contentHash(body)};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 return {output,digest:report.digest,roles:rows.map(r=>({roleId:r.roleId,originalUnchanged:r.originalUnchanged,modelFactories:r.modelFactories,selectedVersions:r.preview.basedOn.selections.map(s=>s.selectedVersion)})),liveModelCalls:0,qualityClaimEligible:false,formalCommitted:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==2)throw Error();console.log(JSON.stringify(await writeCloseoutPreviewDemo()));}catch{console.error('CLOSEOUT_PREVIEW_DEMO_FAILED');process.exitCode=2;}
}
