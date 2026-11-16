import {readFile,writeFile,mkdir,mkdtemp,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {runAgentJourneyCase} from './run.ts';
import {WorkflowSchema} from '../../packages/contracts/src/session-workflow.ts';
import {AgentRunRequestSchema,AgentRunSnapshotSchema,AgentRunEventSchema} from '../../packages/contracts/src/agent-run.ts';
import {MemoryIdentitySchema,MemorySnapshotSchema} from '../../packages/contracts/src/memory.ts';
import {FeedbackRevisionHistorySchema} from '../../packages/contracts/src/feedback-revision.ts';
import {RoleIdSchema} from '../../packages/contracts/src/tools.ts';
import {restoreInterviewWorkflow} from '../../apps/agent/src/orchestration/session-workflow.ts';
import {buildCloseoutPreview,closeoutSnapshotDigest} from '../../apps/agent/src/reporting/closeout-preview.ts';
import {contentHash} from '../answers/validation.ts';
import {collectDeliverySources} from '../delivery/sources.ts';

const digest=z.string().regex(/^[a-f0-9]{64}$/),count=z.number().int().nonnegative(),mode='offline-agent-journey' as const;
const Run=z.object({request:AgentRunRequestSchema,run:AgentRunSnapshotSchema}).strict();
const Case=z.object({version:z.literal(1),mode:z.literal('offline-agent-journey-case'),roleId:RoleIdSchema,identity:MemoryIdentitySchema,
 first:WorkflowSchema,second:WorkflowSchema,secondCreated:WorkflowSchema,
 failure:Run.extend({before:WorkflowSchema,after:WorkflowSchema,replayed:AgentRunSnapshotSchema,callsBeforeReplay:count,callsAfterReplay:count}),retry:Run,
 history:FeedbackRevisionHistorySchema,preview:Run,previewSdkReplayDigest:digest,sourceDigestBeforePreview:digest,sourceDigestAfterPreview:digest,
 providerCallsBeforePreview:count,providerCallsAfterPreview:count,
 trace:z.array(z.object({step:z.string().min(1).max(80),requestDigest:digest,runDigest:digest,runId:z.string().min(1).max(100),status:AgentRunSnapshotSchema.shape.status,events:z.array(AgentRunEventSchema).max(100)}).strict()).max(32),
 stats:z.object({planningProviderCalls:count,scoringProviderCalls:count,deliveryProviderCalls:count,injectedInvalidEvaluations:count,liveModelCalls:z.literal(0)}).strict(),
 formalCommitted:z.literal(false),humanReferenceCount:z.literal(0),qualityClaimEligible:z.literal(false)}).strict();
const names=['java-backend.case.json','java-backend.memory.json','web-frontend.case.json','web-frontend.memory.json'] as const;
const Manifest=z.object({version:z.literal(1),mode:z.literal(mode),files:z.array(z.object({name:z.enum(names),sha256:digest}).strict()).length(4),
 sourceManifest:z.array(z.object({path:z.string(),sha256:digest}).strict()).max(5000),liveModelCalls:z.literal(0),humanReferenceCount:z.literal(0),qualityClaimEligible:z.literal(false),formalCommitted:z.literal(false),digest}).strict();
const byteHash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function bytes(path:string){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('AGENT_JOURNEY_INVALID');const b=await readFile(path);if(b.length>8*1024*1024)throw Error('AGENT_JOURNEY_INVALID');return b;}
const decode=(b:Uint8Array):unknown=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const same=(a:unknown,b:unknown)=>contentHash(a)===contentHash(b);
async function inspect(raw:unknown,rawMemory:unknown){
 const c=Case.parse(raw),memory=MemorySnapshotSchema.parse(rawMemory);
 await restoreInterviewWorkflow(JSON.stringify(c.first),c.identity);await restoreInterviewWorkflow(JSON.stringify(c.second),c.identity);
 const failedOp=c.failure.request.job.type==='workflow'?c.failure.request.job.operation:null;
 const retryOp=c.retry.request.job.type==='workflow'?c.retry.request.job.operation:null;
 const p=c.preview.run.result;
 if(c.preview.request.job.type!=='closeout-preview'||p?.kind!=='uncommitted-closeout-preview')throw Error('AGENT_JOURNEY_INVALID');
 const recomputed=await buildCloseoutPreview(c.preview.request.job.input,c.preview.request.context,{authorizedEditorIds:['synthetic-journey-editor'],now:()=>p.generatedAt});
 const recalled=memory.sessions.flatMap(s=>s.observations);
 const steps=['first.create','first.plan0','first.answer0.failed','first.answer0.retry','first.plan1','first.answer1','first.finish','second.create','second.plan','second.answer','second.finish','second.preview'];
 const checks={
  roleAndOwnerBound:c.identity.roleId===c.roleId&&[c.first,c.second,c.secondCreated].every(s=>same(s.identity,c.identity))&&memory.userId===c.identity.userId&&memory.roleId===c.roleId,
  firstSessionCompleted:c.first.phase==='completed'&&c.first.turns.length===2&&c.first.closeout!==null,
  failureHasNoCandidate:c.failure.run.status==='failed'&&c.failure.run.error?.code==='MODEL_OUTPUT_INVALID'&&c.failure.run.result===null&&c.stats.injectedInvalidEvaluations===1,
  failurePreservesSource:same(c.failure.before,c.failure.after)&&failedOp?.action==='answer'&&same(failedOp.snapshot,c.failure.before),
  failedRunReplayDoesNotCallProvider:same(c.failure.replayed,c.failure.run)&&c.failure.callsBeforeReplay===c.failure.callsAfterReplay&&c.failure.callsBeforeReplay>0,
  explicitRetryUsesSameAnswer:failedOp?.action==='answer'&&retryOp?.action==='answer'&&c.failure.request.context.runId!==c.retry.request.context.runId&&same(failedOp.command.answer,retryOp.command.answer)&&
   same(retryOp.snapshot,c.failure.after)&&c.retry.run.status==='completed'&&c.first.turns[0]?.input.context.runId===c.retry.request.context.runId,
  memoryFileFromFirstCloseout:same(memory,c.first.closeout?.memoryCandidate)&&same(c.secondCreated.baseMemory,memory)&&same(c.second.baseMemory,memory),
  secondSessionRecallsPrior:recalled.length===2&&same(c.secondCreated.state.priorEvidence,recalled)&&same(c.second.state.priorEvidence,recalled)&&c.second.state.sessionId!==c.first.state.sessionId,
  secondSessionUsesUnseenQuestion:c.second.turns.length===1&&c.second.issuedQuestions.length===1&&!c.first.askedQuestionIds.includes(c.second.issuedQuestions[0]!.questionId),
  stateAwareKnowledgePlanning:[c.first,c.second].every(s=>s.lastPlan?.selection.status==='selected'&&s.lastPlan.receipts.some(r=>r.status!=='error'&&(r.data?.items.length??0)>0)),
  previewBoundToSecond:same(c.preview.request.job.input.snapshot,c.second)&&same(c.preview.request.job.input.selections[0]?.history,c.history)&&same(recomputed.report,p.report),
  previewPreservesScoresAndOriginal:same(p.report.assessments.map(a=>a.evaluation),c.second.closeout?.report.assessments.map(a=>a.evaluation))&&
   c.sourceDigestBeforePreview===c.sourceDigestAfterPreview&&c.sourceDigestAfterPreview===closeoutSnapshotDigest(c.second),
  previewDoesNotCallProvider:c.providerCallsBeforePreview===c.providerCallsAfterPreview&&c.previewSdkReplayDigest===contentHash(c.preview.run),
  keyRunsBoundToTrace:[['first.answer0.failed',c.failure],['first.answer0.retry',c.retry],['second.preview',c.preview]].every(([step,item])=>{
   const r=item as z.infer<typeof Run>,t=c.trace.find(t=>t.step===step);return !!t&&t.runId===r.request.context.runId&&t.runId===r.run.runId&&t.requestDigest===contentHash(r.request)&&t.runDigest===contentHash(r.run)&&t.events.at(-1)?.seq===r.run.lastEventSeq;
  }),
  traceHasAllTerminalEvents:same(c.trace.map(t=>t.step),steps)&&c.trace.every(t=>t.events.length>0&&t.events.every((e,n)=>e.runId===t.runId&&e.seq===n+1)&&
   t.events.at(-1)?.type===(t.status==='failed'?'run.failed':'run.completed')),
  realSdkWithLocalProvider:c.stats.planningProviderCalls>=6&&c.stats.scoringProviderCalls===4&&c.stats.deliveryProviderCalls>=1&&c.stats.liveModelCalls===0,
  noFormalOrQualityClaim:p.formalCommitted===false&&p.qualityClaimEligible===false&&p.readOnly===true,
 };
 if(!Object.values(checks).every(Boolean))throw Error('AGENT_JOURNEY_INVALID');
 return {roleId:c.roleId,checks,scoredTurns:c.first.turns.length+c.second.turns.length,failedRuns:c.trace.filter(t=>t.status==='failed').length,recalledObservations:c.secondCreated.state.priorEvidence.length};
}
export async function verifyAgentJourney(directory:string){
 try{
  const dir=resolve(directory),report=Manifest.parse(decode(await bytes(join(dir,'report.json')))),{digest:expected,...body}=report;
  if(contentHash(body)!==expected||new Set(report.files.map(f=>f.name)).size!==4)throw Error();
  const files=new Map<string,unknown>();for(const f of report.files){const b=await bytes(join(dir,f.name));if(byteHash(b)!==f.sha256)throw Error();files.set(f.name,decode(b));}
  const roles=[];for(const role of ['java-backend','web-frontend']as const){const r=await inspect(files.get(role+'.case.json'),files.get(role+'.memory.json'));if(r.roleId!==role)throw Error();roles.push(r);}
  const current=await collectDeliverySources(process.cwd());
  return {verified:true as const,status:'passed-offline-agent-journey' as const,roles,sameSource:same(current,report.sourceManifest),producerSourceDigest:contentHash(report.sourceManifest),analyzerSourceDigest:contentHash(current),
   liveModelCalls:0 as const,humanReferenceCount:0 as const,qualityClaimEligible:false as const,formalCommitted:false as const};
 }catch{throw Error('AGENT_JOURNEY_INVALID');}
}
export async function writeAgentJourney(){
 const root=resolve('.cache/agent-journey');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'run-'));
 for(const roleId of ['java-backend','web-frontend']as const){const c=await runAgentJourneyCase(roleId,output);await writeFile(join(output,roleId+'.case.json'),JSON.stringify(c,null,2)+'\n',{flag:'wx'});}
 const files=[];for(const name of names)files.push({name,sha256:byteHash(await bytes(join(output,name)))});
 const body={version:1,mode,files,sourceManifest:await collectDeliverySources(process.cwd()),liveModelCalls:0,humanReferenceCount:0,qualityClaimEligible:false,formalCommitted:false};
 await writeFile(join(output,'report.json'),JSON.stringify({...body,digest:contentHash(body)},null,2)+'\n',{flag:'wx'});
 return {output,...await verifyAgentJourney(output)};
}
