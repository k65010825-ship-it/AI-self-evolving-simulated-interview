import {createHash} from 'node:crypto';
import {z} from 'zod';
import {CloseoutPreviewInputSchema,CloseoutPreviewSchema,type CloseoutPreview} from '../../../../packages/contracts/src/closeout-preview.ts';
import {WorkflowSchema} from '../../../../packages/contracts/src/session-workflow.ts';
import {ToolContextSchema} from '../../../../packages/contracts/src/tools.ts';
import {replayFeedbackRevisions} from '../../../../packages/interview-domain/src/feedback-revision.ts';
import {restoreInterviewWorkflow} from '../orchestration/session-workflow.ts';
import {AgentStateError} from '../planning/interview-state.ts';

const canonical=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical((v as Record<string,unknown>)[k])}`).join(',')}}`;
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export const closeoutSnapshotDigest=(raw:unknown)=>hash(WorkflowSchema.parse(raw));
export interface CloseoutPreviewDependencies{authorizedEditorIds:readonly string[];now?:()=>number;signal?:AbortSignal;}
/** Independent read-only report projection: never writes the workflow or admits a commit. */
export async function buildCloseoutPreview(rawInput:unknown,rawContext:unknown,deps:CloseoutPreviewDependencies):Promise<CloseoutPreview>{
 const input=CloseoutPreviewInputSchema.safeParse(rawInput),context=ToolContextSchema.safeParse(rawContext);
 const editors=z.array(z.string().min(1).max(100)).max(100).safeParse(deps.authorizedEditorIds);
 if(!input.success||!context.success||!editors.success)throw new AgentStateError('VALIDATION_ERROR');
 const i=input.data,c=context.data,now=deps.now??Date.now;
 const check=()=>{if(deps.signal?.aborted)throw new AgentStateError('RUN_CANCELLED');const at=now();if(!Number.isSafeInteger(at)||at<0)throw new AgentStateError('VALIDATION_ERROR');if(at>=c.deadlineAt)throw new AgentStateError('DEADLINE_EXCEEDED');return at;};
 check();if(c.userId!==i.snapshot.identity.userId||c.roleId!==i.snapshot.identity.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
 if(hash(i.snapshot)!==i.expectedSnapshotDigest)throw new AgentStateError('VALIDATION_ERROR');
 if(i.snapshot.phase!=='completed'||!i.snapshot.closeout)throw new AgentStateError('VERSION_CONFLICT');
 const snapshot=await restoreInterviewWorkflow(JSON.stringify(i.snapshot),{userId:c.userId,roleId:c.roleId});
 const at=check(),original=snapshot.closeout!.report;if(at<original.generatedAt)throw new AgentStateError('VALIDATION_ERROR');
 const report=structuredClone(original),selections:CloseoutPreview['basedOn']['selections']=[];
 for(const selection of i.selections){
  check();const turn=snapshot.turns.find(t=>t.input.answer.id===selection.answerId),assessment=report.assessments.find(a=>a.answerId===selection.answerId);
  if(!turn||!assessment)throw new AgentStateError('VALIDATION_ERROR');
  let replay;
  try{replay=replayFeedbackRevisions(turn.input,turn.proposal,selection.history,{userId:c.userId,roleId:c.roleId,sessionId:snapshot.state.sessionId,
   editorId:'preview-reader',authorizedEditorIds:editors.data,now:at});}catch{check();throw new AgentStateError('VALIDATION_ERROR');}
  const selected=replay.versions.find(v=>v.version===selection.version);if(!selected)throw new AgentStateError('VALIDATION_ERROR');
  assessment.feedback=structuredClone(selected.projection.feedback);assessment.feedbackPublication=structuredClone(selected.projection.publication);assessment.feedbackVerification='not_verified';
  selections.push({answerId:selection.answerId,historyDigest:selection.history.digest,headVersion:selection.history.records.length,selectedVersion:selection.version,
   selectedSourceDigest:selected.sourceDigest,...(selected.projection.publication.revisionDigest?{revisionDigest:selected.projection.publication.revisionDigest}:{})});
 }
 report.warnings=[...new Set([...report.warnings.filter(w=>w!=='feedback_items_withheld_pending_review'),
  ...(report.assessments.some(a=>(a.feedbackPublication?.withheldCount??0)>0)?['feedback_items_withheld_pending_review']:[]),'feedback_revision_preview_not_formal_report'])];
 check();return CloseoutPreviewSchema.parse({kind:'uncommitted-closeout-preview',version:1,generatedAt:at,
  basedOn:{snapshotDigest:i.expectedSnapshotDigest,reportDigest:hash(original),sessionId:snapshot.state.sessionId,workflowRevision:snapshot.revision,stateVersion:snapshot.state.version,selections},
  report,readOnly:true,formalCommitted:false,qualityClaimEligible:false,identityVerified:false,liveModelCalls:0});
}
