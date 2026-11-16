import { randomUUID } from 'node:crypto';
import { FieldEvidenceInputSchema, FieldReviewLabelSchema, FieldKnowledgeReviewSchema, FieldCohortInputSchema, type FieldReviewLabel, type FieldEvidenceInput } from '../../packages/contracts/src/field-evidence.ts';
import { contentHash } from '../answers/validation.ts';
const authority='file-declared-unverified' as const;
const ratio=(numerator:number,denominator:number)=>({numerator,denominator,value:denominator?numerator/denominator:null});
const unique=(values:string[])=>new Set(values).size===values.length;
const visible=(item:FieldEvidenceInput['items'][number])=>({roleId:item.roleId,kind:item.kind,version:item.version,sourceReferences:item.sourceReferences,payload:item.payload});
const applicable={answer:['humanScore','citationSupported','answerLeaked'],continuation:['continuationAccurate','answerLeaked'],expression:['expressionReliable'],knowledge:['citationSupported']} as const;
function fail(message:string):never{throw new Error(`FIELD_EVIDENCE_${message}`);}
export function createReviewBundle(raw:unknown){
 const input=FieldEvidenceInputSchema.parse(raw);
 if(!unique(input.items.map(i=>i.id)))fail('DUPLICATE_ITEM');
 if(input.items.some(i=>input.developmentGroupIds.includes(i.sourceGroupId)))fail('GROUP_CONTAMINATION');
 const tasks=input.items.map(item=>({taskId:randomUUID(),taskDigest:contentHash(visible(item)),privateDigest:contentHash(item),item}));
 return {schemaVersion:1 as const,authority,privateManifest:{...input,items:undefined,tasks},reviewPacket:{schemaVersion:1 as const,datasetId:input.datasetId,instructions:'Review independently; do not exchange labels. Blank fields are deliberately invalid. Content may contain identifying details; redact and re-export before distribution.',tasks:tasks.map(t=>({taskId:t.taskId,taskDigest:t.taskDigest,...visible(t.item)})),labelTemplate:tasks.map(t=>({taskId:t.taskId,taskDigest:t.taskDigest,reviewId:null,reviewerId:null,reviewedAt:null,humanScore:null,citationSupported:null,continuationAccurate:null,answerLeaked:null,expressionReliable:null,rationale:null}))}};
}
export type ReviewBundle=ReturnType<typeof createReviewBundle>;
/** Reconstruct from source fields and verify immutable content bindings on every import. */
function validateBundle(b:ReviewBundle){
 if(b.schemaVersion!==1||b.authority!==authority)fail('BUNDLE_INVALID');
 const m=b.privateManifest;
 FieldEvidenceInputSchema.parse({datasetId:m.datasetId,developmentGroupIds:m.developmentGroupIds,developmentReviewerIds:m.developmentReviewerIds,minimumCases:m.minimumCases,items:m.tasks.map(t=>t.item)});
 if(!unique(m.tasks.map(t=>t.taskId))||!unique(m.tasks.map(t=>t.item.id))||m.tasks.some(t=>t.privateDigest!==contentHash(t.item)||t.taskDigest!==contentHash(visible(t.item))||m.developmentGroupIds.includes(t.item.sourceGroupId)))fail('BUNDLE_STALE');
 const projection=m.tasks.map(t=>({taskId:t.taskId,taskDigest:t.taskDigest,...visible(t.item)}));
 if(b.reviewPacket.datasetId!==m.datasetId||contentHash(projection)!==contentHash(b.reviewPacket.tasks))fail('PUBLIC_PACKET_STALE');
}
function independent(b:ReviewBundle,taskId:string,taskDigest:string,reviewerId:string){
 const task=b.privateManifest.tasks.find(t=>t.taskId===taskId);
 if(!task||task.taskDigest!==taskDigest)fail('STALE_REVIEW');
 if(b.privateManifest.tasks.some(t=>t.item.authorId===reviewerId)||b.privateManifest.developmentReviewerIds.includes(reviewerId))fail('REVIEWER_CONTAMINATION');
 return task;
}
export function importReviews(b:ReviewBundle,raw:unknown):FieldReviewLabel[]{
 validateBundle(b); const labels=FieldReviewLabelSchema.array().max(20000).parse(raw);
 if(!unique(labels.map(l=>l.reviewId))||!unique(labels.map(l=>JSON.stringify([l.taskId,l.reviewerId]))))fail('DUPLICATE_REVIEW');
 for(const l of labels)independent(b,l.taskId,l.taskDigest,l.reviewerId);
 return labels;
}
export function evaluateReviews(b:ReviewBundle,raw:unknown){
 const labels=importReviews(b,raw);const tasks=b.privateManifest.tasks;
 const applies=(taskId:string,key:string)=>{const task=tasks.find(t=>t.taskId===taskId)!;return (applicable[task.item.kind] as readonly string[]).includes(key);};
 const complete=tasks.filter(t=>labels.filter(l=>l.taskId===t.taskId&&applicable[t.item.kind].every(key=>l[key]!==null)).length>=2);
 const truth=(key:'citationSupported'|'continuationAccurate'|'expressionReliable'|'answerLeaked',inverse=false)=>{const rows=labels.filter(l=>applies(l.taskId,key)&&l[key]!==null);return ratio(rows.filter(l=>l[key]===!inverse).length,rows.length);};
 let agreements=0,pairs=0,modelMatches=0,modelTotal=0;
 for(const t of tasks){const rows=labels.filter(l=>l.taskId===t.taskId&&applies(l.taskId,'humanScore')&&l.humanScore!==null);for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){pairs++;if(Math.abs(rows[i]!.humanScore!-rows[j]!.humanScore!)<=0.1+1e-12)agreements++;}if(t.item.modelScore!==null)for(const l of rows){modelTotal++;if(Math.abs(t.item.modelScore-l.humanScore!)<=0.1+1e-12)modelMatches++;}}
 const metrics={scoringAgreement:ratio(agreements,pairs),modelScoreAgreement:ratio(modelMatches,modelTotal),citationSupport:truth('citationSupported'),continuationAccuracy:truth('continuationAccurate'),noLeak:truth('answerLeaked',true),expressionReliability:truth('expressionReliable')};
 const thresholds={scoringAgreement:0.9,modelScoreAgreement:0.9,citationSupport:0.95,continuationAccuracy:0.95,noLeak:1,expressionReliability:0.95};
 const needed=new Set(tasks.flatMap(t=>applicable[t.item.kind]));
 const requiredMetrics={scoringAgreement:needed.has('humanScore'),modelScoreAgreement:tasks.some(t=>t.item.kind==='answer'&&t.item.modelScore!==null),citationSupport:needed.has('citationSupported'),continuationAccuracy:needed.has('continuationAccurate'),noLeak:needed.has('answerLeaked'),expressionReliability:needed.has('expressionReliable')};
 const missing=tasks.length<b.privateManifest.minimumCases||complete.length!==tasks.length||Object.entries(metrics).some(([key,m])=>requiredMetrics[key as keyof typeof requiredMetrics]&&m.denominator===0);
 const failures=Object.entries(metrics).filter(([key,m])=>m.value!==null&&m.value<thresholds[key as keyof typeof thresholds]).map(([key])=>key);
 return {kind:'declared-independent-review-report',authority,status:missing?'not_ready' as const:failures.length?'failed' as const:'passed' as const,qualityClaimEligible:false,identityVerified:false,productionPublished:false,totalCases:tasks.length,completeCases:complete.length,missingCaseIds:tasks.filter(t=>!complete.includes(t)).map(t=>t.item.id),reviewers:new Set(labels.map(l=>l.reviewerId)).size,sourceGroups:new Set(tasks.map(t=>t.item.sourceGroupId)).size,metrics,requiredMetrics,thresholds,failures,minimumCases:b.privateManifest.minimumCases,limitations:['Reviewer identities and independence are file declarations, not authenticated expert approval.','Thresholds are engineering collection gates, not evidence of population validity.']};
}
export function importKnowledgeReview(b:ReviewBundle,raw:unknown){
 validateBundle(b);const review=FieldKnowledgeReviewSchema.parse(raw);const task=independent(b,review.taskId,review.taskDigest,review.reviewerId);
 if(task.item.kind!=='knowledge')fail('NOT_KNOWLEDGE');
 if(review.decision==='approved'&&!Object.values(review.checks).every(Boolean))fail('INCOMPLETE_CHECKS');
 return {kind:'uncommitted-knowledge-review-proposal',authority,itemId:task.item.id,itemVersion:task.item.version,contentDigest:task.taskDigest,sourceGroupId:task.item.sourceGroupId,sourceReferences:task.item.sourceReferences,sourceSnapshot:task.item.payload,...review,productionPublished:false,catalogUpdated:false,identityVerified:false};
}
export function evaluateCohort(raw:unknown){
 const input=FieldCohortInputSchema.parse(raw);if(input.baselinePolicyVersion===input.candidatePolicyVersion)fail('POLICY_VERSIONS_IDENTICAL');
 if(!unique(input.pairs.map(p=>p.pairId)))fail('DUPLICATE_PAIR');
 const counts=(values:string[])=>{const m=new Map<string,number>();for(const v of values)m.set(v,(m.get(v)??0)+1);return m;};
 const students=counts(input.pairs.map(p=>p.studentId));
 const artifactCounts=counts(input.pairs.flatMap(p=>[p.before?.answerId,p.after?.answerId,p.before?.reviewId,p.after?.reviewId,p.learningArtifactId??undefined].filter((s):s is string=>!!s)));
 const groups=new Map<string,Set<string>>();for(const p of input.pairs){const a=groups.get(p.sourceGroupId)??new Set();a.add(p.arm);groups.set(p.sourceGroupId,a);}
 const exclusions:{pairId:string;reasons:string[]}[]=[];
 const eligible=input.pairs.filter(p=>{
  const reasons:string[]=[];const before=p.before,after=p.after;
  if(!before||!after||before.score===null||after.score===null)reasons.push('missing_observation');
  if(p.dataMode!=='consented'||!p.consentRecordId)reasons.push('unconsented_or_simulated');
  if(input.developmentGroupIds.includes(p.sourceGroupId)||groups.get(p.sourceGroupId)!.size>1)reasons.push('source_group_contamination');
  if(students.get(p.studentId)!>1)reasons.push('student_reused');
  if(p.policyVersion!==(p.arm==='baseline'?input.baselinePolicyVersion:input.candidatePolicyVersion))reasons.push('policy_mismatch');
  if(!p.learningArtifactId||p.learningVerifiedAt===null)reasons.push('learning_unverified');
  if(before&&after){
   if([before.answerId,after.answerId,before.reviewId,after.reviewId,...(p.learningArtifactId?[p.learningArtifactId]:[])].some(id=>artifactCounts.get(id)!>1))reasons.push('artifact_reused');
   if(before.questionId===after.questionId||before.sessionId===after.sessionId)reasons.push('retest_leakage');
   if(before.reviewerId===p.studentId||after.reviewerId===p.studentId)reasons.push('self_review');
   if(input.developmentReviewerIds.includes(before.reviewerId)||input.developmentReviewerIds.includes(after.reviewerId))reasons.push('reviewer_contamination');
   if(p.learningVerifiedAt!==null&&!(before.submittedAt<p.learningVerifiedAt&&p.learningVerifiedAt<after.questionIssuedAt&&after.questionIssuedAt<=after.submittedAt))reasons.push('invalid_chronology');
  }
  if(reasons.length)exclusions.push({pairId:p.pairId,reasons});return reasons.length===0;
 });
 const strata=new Set(eligible.map(p=>JSON.stringify([p.roleId,p.skillId,p.rubricId,p.rubricVersion,p.difficulty])));
 const summarize=(arm:'baseline'|'candidate')=>{const ps=eligible.filter(p=>p.arm===arm);const gains=ps.map(p=>p.after!.score!-p.before!.score!);return{enrolled:input.pairs.filter(p=>p.arm===arm).length,eligiblePairs:ps.length,distinctStudents:new Set(ps.map(p=>p.studentId)).size,improved:ratio(gains.filter(g=>g>0).length,gains.length),gainSum:gains.reduce((a,b)=>a+b,0),gainDenominator:gains.length,meanGain:gains.length?gains.reduce((a,b)=>a+b,0)/gains.length:null};};
 const arms={baseline:summarize('baseline'),candidate:summarize('candidate')};
 const ready=exclusions.length===0&&strata.size===1&&Object.values(arms).every(a=>a.eligiblePairs>=input.minimumPairsPerArm);
 return {kind:'declared-human-cohort-report',studyId:input.studyId,authority,status:ready?'ready_descriptive' as const:'not_ready' as const,causalEffectEstablished:false,identityVerified:false,rsiEffectEstablished:false,minimumPairsPerArm:input.minimumPairsPerArm,totalPairs:input.pairs.length,eligiblePairs:eligible.length,excludedPairs:exclusions.length,exclusions,compatibleStrata:strata.size,arms,deltaOfMeanGains:ready?arms.candidate.meanGain!-arms.baseline.meanGain!:null,limitations:['Consent, reviews and practice artifacts require independent verification outside this file pipeline.','Pre/post gain and candidate/baseline gain difference are descriptive; selection, practice and rubric effects are uncontrolled.','No causal RSI or student learning claim is established.']};
}





