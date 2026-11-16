import {beforeAll,expect,test} from 'bun:test';
import {runSessionWorkflowDemo} from '../scripts/demo-session-workflow.ts';
import {buildCloseoutPreview,closeoutSnapshotDigest} from '../apps/agent/src/reporting/closeout-preview.ts';
import {createFeedbackRevisionHistory,proposeFeedbackRevision} from '../packages/interview-domain/src/feedback-revision.ts';
import {CloseoutPreviewInputSchema} from '../packages/contracts/src/closeout-preview.ts';
import type {InterviewWorkflow} from '../packages/contracts/src/session-workflow.ts';
import {contentHash} from '../evals/answers/validation.ts';
import {createLiveRunManager} from '../apps/agent/src/runtime/live-runtime.ts';
import example from '../apps/agent/src/model-access/qianwen.example.json' with {type:'json'};
let snapshot:InterviewWorkflow;
beforeAll(async()=>{snapshot=(await runSessionWorkflowDemo()).session;});
function fixture(){
 const t=snapshot.turns[0]!,now=Date.now(),host={...snapshot.identity,sessionId:snapshot.state.sessionId,editorId:'synthetic-preview-editor',authorizedEditorIds:['synthetic-preview-editor'],now};
 let history=createFeedbackRevisionHistory(t.input,t.proposal);
 history=proposeFeedbackRevision(t.input,t.proposal,history,{requestId:'preview-edit',expectedVersion:0,expectedHeadDigest:history.headSourceDigest,feedback:{strengths:[],improvements:['修订预览建议，未独立审核']},note:'synthetic fixture'},host).history;
 return {input:{snapshot,expectedSnapshotDigest:closeoutSnapshotDigest(snapshot),selections:[{answerId:t.input.answer.id,history,version:1}]},
  context:{...snapshot.identity,runId:'preview-run',attemptId:'a',deadlineAt:now+60000},deps:{authorizedEditorIds:['synthetic-preview-editor'],now:()=>now}};
}
test('preview changes selected feedback only and leaves the source workflow and all scores intact',async()=>{
 const f=fixture(),before=contentHash(snapshot),p=await buildCloseoutPreview(f.input,f.context,f.deps);
 expect(p.kind).toBe('uncommitted-closeout-preview');expect(p.formalCommitted).toBe(false);expect(p.qualityClaimEligible).toBe(false);
 expect(p.report.assessments[0]!.feedback.improvements).toEqual(['修订预览建议，未独立审核']);
 expect(p.report.assessments.map(a=>a.evaluation)).toEqual(snapshot.closeout!.report.assessments.map(a=>a.evaluation));
 expect(p.report.studyPlan).toEqual(snapshot.closeout!.report.studyPlan);expect(p.report.assessments[1]).toEqual(snapshot.closeout!.report.assessments[1]);
 expect(contentHash(snapshot)).toBe(before);expect(p.basedOn.snapshotDigest).toBe(f.input.expectedSnapshotDigest);
});
test('old version is a read-only view, not a rollback of history head',async()=>{
 const f=fixture();f.input.selections[0]!.version=0;const h=contentHash(f.input.selections[0]!.history),p=await buildCloseoutPreview(f.input,f.context,f.deps);
 expect(p.report.assessments[0]!.feedback).toEqual(snapshot.closeout!.report.assessments[0]!.feedback);
 expect(p.basedOn.selections[0]!.headVersion).toBe(1);expect(p.basedOn.selections[0]!.selectedVersion).toBe(0);expect(contentHash(f.input.selections[0]!.history)).toBe(h);
});
test('snapshot, ownership, selection and authorization errors never yield a preview',async()=>{
 const a=fixture();a.input.expectedSnapshotDigest='0'.repeat(64);await expect(buildCloseoutPreview(a.input,a.context,a.deps)).rejects.toThrow();
 const b=fixture();await expect(buildCloseoutPreview(b.input,{...b.context,userId:'other'},b.deps)).rejects.toThrow();
 await expect(buildCloseoutPreview(b.input,b.context,{...b.deps,authorizedEditorIds:[]})).rejects.toThrow();
 const c=fixture();c.input.selections[0]!.answerId='unknown';await expect(buildCloseoutPreview(c.input,c.context,c.deps)).rejects.toThrow();
 const d=fixture();d.input.selections[0]!.version=20;await expect(buildCloseoutPreview(d.input,d.context,d.deps)).rejects.toThrow();
 expect(CloseoutPreviewInputSchema.safeParse({...d.input,selections:[d.input.selections[0],d.input.selections[0]]}).success).toBe(false);
});
test('abort and deadline stop pure previews without evaluating or changing source records',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();
 await expect(buildCloseoutPreview(f.input,f.context,{...f.deps,signal:controller.signal})).rejects.toThrow('RUN_CANCELLED');
 await expect(buildCloseoutPreview(f.input,{...f.context,deadlineAt:f.deps.now()},f.deps)).rejects.toThrow('DEADLINE_EXCEEDED');
});
test('configured live factory performs a zero-revision preview without credentials, HTTP or model budget reservations',async()=>{
 const f=fixture(),runtime=createLiveRunManager({...example,authorization:{enabled:true,operatorApproved:true,expiresAt:Date.now()+60000,maxRuns:1}},
  {readCredential:()=>{throw Error('must not read');},fetch:async()=>{throw Error('must not send');},hasBlockedAccounting:()=>true});
 try{
  runtime.start({inputSnapshotId:'no-model-preview',context:{...f.context,runId:'no-model-preview'},job:{type:'closeout-preview',input:{...f.input,selections:[]}}});
  await runtime.wait('no-model-preview');expect(runtime.snapshot('no-model-preview').status).toBe('completed');expect(runtime.modelAccounting()).toEqual([]);
 }finally{runtime.dispose();}
});
