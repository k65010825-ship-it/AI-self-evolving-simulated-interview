import {readFile,lstat,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {z} from 'zod';
import {BatchSchema} from './dataset.ts';
import {contentHash} from '../answers/validation.ts';
import {AgentRunRequestSchema,AgentRunSnapshotSchema} from '../../packages/contracts/src/agent-run.ts';
import {LiveServiceConfigSchema} from '../../packages/contracts/src/live-model.ts';
import {selectNextQuestion} from '../../apps/agent/src/planning/select-question.ts';
import {reviewFeedback} from '../../apps/agent/src/evaluation/feedback-review.ts';
import {projectFeedbackPublication} from '../../packages/interview-domain/src/feedback-publication.ts';
import {createReviewBundle} from '../field-evidence/index.ts';
import {collectDeliverySources} from '../delivery/sources.ts';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const Report=z.object({version:z.literal(1),batchDigest:digest,configDigest:digest,digest,
 rows:z.array(z.object({role:z.enum(['java-backend','web-frontend']),stage:z.enum(['wrong','ambiguous','supplement']),requestDigest:digest,snapshot:AgentRunSnapshotSchema}).passthrough()).max(6)}).passthrough();
async function readJson(path:string){
 const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)throw Error('FEEDBACK_REVIEW_FILE_INVALID');
 const bytes=await readFile(path);if(bytes.length>4*1024*1024)throw Error('FEEDBACK_REVIEW_FILE_INVALID');
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;
}
function assertDigest(raw:unknown){const value=z.object({digest}).passthrough().parse(raw),{digest:expected,...body}=value;if(contentHash(body)!==expected)throw Error('FEEDBACK_REVIEW_DIGEST_INVALID');}
/** Retrospective reader: intrinsic hashes survive source evolution. No runtime or credentials. */
export async function inspectFeedbackBatch(directory:string){
 const dir=resolve(directory),rawBatch=await readJson(join(dir,'batch.json')),rawReport=await readJson(join(dir,'report.json'));
 assertDigest(rawBatch);assertDigest(rawReport);
 const batch=BatchSchema.parse(rawBatch),report=Report.parse(rawReport);
 const config=LiveServiceConfigSchema.parse(await readJson(join(dir,'config.authorized.json')));
 const pin=z.object({batchDigest:digest,configDigest:digest,startedAt:z.number().int()}).strict().parse(await readJson(join(dir,'execution.json')));
 if(report.batchDigest!==batch.digest||report.configDigest!==contentHash(config)||contentHash(config.profile)!==contentHash(batch.profile)||pin.batchDigest!==batch.digest||pin.configDigest!==report.configDigest||pin.startedAt!==report.startedAt||new Set(batch.samples.map(s=>s.role)).size!==2)throw Error('FEEDBACK_REVIEW_SOURCE_INVALID');
 const seen=new Set<string>(),reviews:(ReturnType<typeof reviewFeedback>&{publicationPreview:ReturnType<typeof projectFeedbackPublication>})[]=[];
 const reviewItems=[];
 for(const row of report.rows){
  const key=row.role+'-'+row.stage;if(seen.has(key))throw Error('FEEDBACK_REVIEW_DUPLICATE_ROW');seen.add(key);
  const request=AgentRunRequestSchema.parse(await readJson(join(dir,key+'.request.json'))),sample=batch.samples.find(s=>s.role===row.role)!;
  if(contentHash(request)!==row.requestDigest||request.job.type!=='turn')throw Error('FEEDBACK_REVIEW_REQUEST_INVALID');
  const input=request.job.input,expectedRun=`quality-${batch.id}-${row.role}-${row.stage}`;
  const expectedAnswer=row.stage==='supplement'?sample.ambiguous+'\n'+sample.supplement:sample[row.stage];
  const selected=selectNextQuestion({state:input.state,now:input.state.startedAt,knowledge:[sample.item],askedQuestionIds:[]},{allowDraftKnowledge:true});
  if(selected.status!=='selected'||contentHash(selected.question)!==contentHash(input.question)||contentHash(selected.rubric)!==contentHash(input.rubric)||input.answer.text!==expectedAnswer||input.answer.id!=='answer-'+row.stage||input.context.roleId!==row.role||request.context.runId!==expectedRun||request.context.attemptId!==row.stage||request.inputSnapshotId!==expectedRun||row.snapshot.runId!==expectedRun||row.snapshot.attemptId!==request.context.attemptId||row.snapshot.inputSnapshotId!==request.inputSnapshotId)throw Error('FEEDBACK_REVIEW_REQUEST_BINDING_INVALID');
  const result=row.snapshot.result;if(result?.kind!=='uncommitted-turn-result')continue;
  const review=reviewFeedback(input,result.proposal);reviews.push({...review,publicationPreview:projectFeedbackPublication(input,result.proposal)});
  for(const item of review.items)reviewItems.push({id:key+'-'+item.kind+'-'+item.index,version:'feedback-review-v1',roleId:row.role,kind:'answer' as const,authorId:'assistant-proposed',sourceGroupId:batch.id,
   modelScore:null,sourceReferences:[{sourceId:sample.item.id,sourceVersion:sample.item.version,locator:key}],
   payload:{purpose:'Review this feedback against the complete original answer; candidate excerpts are not a support verdict. Score fields may remain blank until independently reviewed.',question:input.question.text,answer:input.answer.text,feedbackKind:item.kind,feedback:item.text,candidateEvidence:item.candidateEvidence}});
 }
 const bundle=createReviewBundle({datasetId:'feedback-'+batch.id,developmentGroupIds:[],developmentReviewerIds:['assistant-proposed'],minimumCases:8,items:reviewItems});
 return {version:1,source:{batchDigest:batch.digest,reportDigest:report.digest,configDigest:report.configDigest,historicalSourceManifestDigest:contentHash(batch.sourceManifest)},
  reviews,reviewBundle:bundle,status:reviews.some(r=>r.status==='blocked-fact-contradiction')?'blocked-fact-contradiction':'pending-independent-review',
  humanReferenceCount:0,qualityClaimEligible:false,liveModelCalls:0,limitations:['Intrinsic hashes are consistency checks, not authenticated execution or human evidence.','Development arithmetic profile covers restricted explicit assertions only. Scores and original artifacts are unchanged.','Candidate excerpts and cue absence do not establish semantic support or contradiction.']};
}
export async function exportFeedbackReview(directory:string){
 const report=await inspectFeedbackBatch(directory),sourceManifest=await collectDeliverySources(process.cwd());
 const body={...report,analyzerSourceManifest:sourceManifest,analyzerSourceDigest:contentHash(sourceManifest)},outputReport={...body,digest:contentHash(body)};
 const root=resolve('.cache/feedback-review');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'run-'));
 await writeFile(join(output,'report.json'),JSON.stringify(outputReport,null,2)+'\n',{flag:'wx'});
 await writeFile(join(output,'review-packet.json'),JSON.stringify(report.reviewBundle.reviewPacket,null,2)+'\n',{flag:'wx'});
 await writeFile(join(output,'display-feedback.json'),JSON.stringify({version:1,sourceReportDigest:report.source.reportDigest,qualityClaimEligible:false,turns:report.reviews.map(r=>({questionId:r.questionId,answerId:r.answerId,...r.publicationPreview}))},null,2)+'\n',{flag:'wx'});
 return {output,digest:outputReport.digest,status:report.status,scoredTurns:report.reviews.length,feedbackItems:report.reviews.flatMap(r=>r.items).length,contradictions:report.reviews.flatMap(r=>r.items).filter(i=>i.fact.status==='contradiction').length,
  withheldItems:report.reviews.reduce((n,r)=>n+r.publicationPreview.publication.withheldCount,0),humanReferenceCount:0,qualityClaimEligible:false,liveModelCalls:0};
}
