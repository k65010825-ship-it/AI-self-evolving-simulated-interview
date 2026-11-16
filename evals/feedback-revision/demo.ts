import {mkdir,mkdtemp,readFile,writeFile,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {runContentRubricsDemo} from '../../scripts/demo-content-rubrics.ts';
import {createFeedbackRevisionHistory,proposeFeedbackRevision,replayFeedbackRevisions} from '../../packages/interview-domain/src/feedback-revision.ts';
import {TurnInputSchema,TurnProposalSchema} from '../../packages/contracts/src/evaluation.ts';
import {FeedbackRevisionHistorySchema} from '../../packages/contracts/src/feedback-revision.ts';
import {RoleIdSchema} from '../../packages/contracts/src/tools.ts';
import {contentHash} from '../answers/validation.ts';
import {collectDeliverySources} from '../delivery/sources.ts';

const digest=z.string().regex(/^[a-f0-9]{64}$/),mode='offline-synthetic-feedback-revision-demo' as const;
const names=['bundle.json','replay.json','display-feedback.json'] as const;
const Manifest=z.object({version:z.literal(1),mode:z.literal(mode),sourceManifest:z.array(z.object({path:z.string(),sha256:digest}).strict()).max(5000),
 files:z.array(z.object({name:z.enum(names),sha256:digest}).strict()).length(3),liveModelCalls:z.literal(0),humanReferenceCount:z.literal(0),qualityClaimEligible:z.literal(false),digest}).strict();
const Bundle=z.object({version:z.literal(1),mode:z.literal(mode),rows:z.array(z.object({roleId:RoleIdSchema,input:TurnInputSchema,proposal:TurnProposalSchema,
 history:FeedbackRevisionHistorySchema,host:z.unknown()}).strict()).length(2)}).strict();
async function bytes(path:string){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)throw Error('FEEDBACK_REVISION_ARTIFACT_INVALID');const b=await readFile(path);if(b.length>4*1024*1024)throw Error('FEEDBACK_REVISION_ARTIFACT_INVALID');return b;}
const decode=(b:Uint8Array):unknown=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const byteHash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
export async function replayFeedbackRevisionDemo(directory:string){
 const dir=resolve(directory),manifest=Manifest.parse(decode(await bytes(join(dir,'manifest.json')))),{digest:expected,...body}=manifest;
 if(contentHash(body)!==expected||new Set(manifest.files.map(f=>f.name)).size!==3)throw Error('FEEDBACK_REVISION_ARTIFACT_INVALID');
 const files=new Map<string,Uint8Array>();for(const f of manifest.files){const b=await bytes(join(dir,f.name));if(byteHash(b)!==f.sha256)throw Error('FEEDBACK_REVISION_ARTIFACT_INVALID');files.set(f.name,b);}
 const bundle=Bundle.parse(decode(files.get('bundle.json')!));if(new Set(bundle.rows.map(r=>r.roleId)).size!==2)throw Error('FEEDBACK_REVISION_ARTIFACT_INVALID');
 const rows=bundle.rows.map(r=>{if(r.input.context.roleId!==r.roleId)throw Error('FEEDBACK_REVISION_ARTIFACT_INVALID');return {roleId:r.roleId,replay:replayFeedbackRevisions(r.input,r.proposal,r.history,r.host)};});
 const display={version:1,mode,qualityClaimEligible:false,rows:rows.map(r=>({roleId:r.roleId,...r.replay.projection}))};
 if(contentHash(rows)!==contentHash(decode(files.get('replay.json')!))||contentHash(display)!==contentHash(decode(files.get('display-feedback.json')!)))throw Error('FEEDBACK_REVISION_ARTIFACT_INVALID');
 const currentSourceManifest=await collectDeliverySources(process.cwd());
 return {mode,roles:rows.length,versions:rows.map(r=>({roleId:r.roleId,versions:r.replay.versions.length,withheldItems:r.replay.projection.publication.withheldCount})),
  sameSource:contentHash(currentSourceManifest)===contentHash(manifest.sourceManifest),producerSourceDigest:contentHash(manifest.sourceManifest),analyzerSourceDigest:contentHash(currentSourceManifest),
  liveModelCalls:0,humanReferenceCount:0,qualityClaimEligible:false,identityVerified:false};
}
export async function writeFeedbackRevisionDemo(){
 const rows=[];
 for(const roleId of ['java-backend','web-frontend'] as const){
  const d=await runContentRubricsDemo(roleId),t=d.reportInput.turns[0]!,input=t.input,proposal=structuredClone(t.proposal);
  proposal.feedback={strengths:['认识竞态并发窗口'],improvements:['原始示例反馈，尚未独立核对']};
  const host={userId:input.context.userId,roleId,sessionId:input.state.sessionId,editorId:'synthetic-demo-editor',authorizedEditorIds:['synthetic-demo-editor'],now:Date.now()};
  let history=createFeedbackRevisionHistory(input,proposal);
  history=proposeFeedbackRevision(input,proposal,history,{requestId:'synthetic-edit',expectedVersion:0,expectedHeadDigest:history.headSourceDigest,
   feedback:{strengths:[],improvements:['按相同条件补充验证步骤；仅为离线修订示例']},note:'AI-authored offline fixture, not expert approval'},host).history;
  history=proposeFeedbackRevision(input,proposal,history,{requestId:'synthetic-return-original',expectedVersion:1,expectedHeadDigest:history.headSourceDigest,
   feedback:proposal.feedback,note:'Returning text is a new revision, not reuse of old review receipts'},host).history;
  rows.push({roleId,input,proposal,host,history});
 }
 const bundle={version:1,mode,rows},replay=rows.map(r=>({roleId:r.roleId,replay:replayFeedbackRevisions(r.input,r.proposal,r.history,r.host)}));
 const display={version:1,mode,qualityClaimEligible:false,rows:replay.map(r=>({roleId:r.roleId,...r.replay.projection}))};
 const payloads=[bundle,replay,display],root=resolve('.cache/feedback-revision');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'run-'));
 const files=[];for(const [index,name] of names.entries()){const b=Buffer.from(JSON.stringify(payloads[index],null,2)+'\n');await writeFile(join(output,name),b,{flag:'wx'});files.push({name,sha256:byteHash(b)});}
 const body={version:1,mode,sourceManifest:await collectDeliverySources(process.cwd()),files,liveModelCalls:0,humanReferenceCount:0,qualityClaimEligible:false};
 await writeFile(join(output,'manifest.json'),JSON.stringify({...body,digest:contentHash(body)},null,2)+'\n',{flag:'wx'});
 return {output,...await replayFeedbackRevisionDemo(output)};
}
