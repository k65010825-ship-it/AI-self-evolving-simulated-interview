import {beforeAll,expect,test} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {prepareQualityBatch} from '../evals/quality-batch/dataset.ts';
import {executeQualityBatch} from '../evals/quality-batch/runner.ts';
import {qualityFixtureFetch} from '../experiments/quality-batch/fixture.ts';
import {projectFeedbackPublication,proposeFeedbackReview} from '../packages/interview-domain/src/feedback-publication.ts';
import {buildInterviewReport} from '../apps/agent/src/reporting/build-report.ts';
import type {TurnInput,TurnProposal} from '../packages/contracts/src/evaluation.ts';
import {ContentReportSchema} from '../packages/contracts/src/report.ts';
import {contentHash} from '../evals/answers/validation.ts';
import {FeedbackPublicationSchema,FeedbackReviewCommandSchema} from '../packages/contracts/src/feedback-publication.ts';
import {EvaluationOutputSchema} from '../packages/contracts/src/evaluation.ts';
let input:TurnInput,proposal:TurnProposal;
beforeAll(async()=>{
 const p=await prepareQualityBatch(),config={...p.config,authorization:{enabled:true,operatorApproved:true,expiresAt:Date.now()+600000,maxRuns:6}};
 const r=await executeQualityBatch(p.output,config,{readCredential:()=> 'synthetic-only',fetch:qualityFixtureFetch});
 input=JSON.parse(await readFile(join(p.output,'java-backend-wrong.request.json'),'utf8')).job.input;
 const result=r.rows[0]!.snapshot.result;if(result?.kind!=='uncommitted-turn-result')throw Error('fixture');proposal=result.proposal;
 proposal.feedback={strengths:['认识竞态并发窗口'],improvements:['正确最大成功数应为99。','补充同步起跑的验证步骤']};
},30000);
const host=()=>({userId:input.context.userId,roleId:input.context.roleId,sessionId:input.state.sessionId,reviewerId:'synthetic-reviewer',authorizedReviewerIds:['synthetic-reviewer'],now:Date.now()});
const command=(decision:'withhold'|'release-unverified',itemIndex=0)=>({requestId:'review-1',sourceDigest:projectFeedbackPublication(input,proposal).publication.sourceDigest,expectedVersion:0,itemIndex,decision,note:'synthetic mechanism test, not human reference'});

test('projection withholds conflict and cue concerns without exposing withheld text or modifying scores',()=>{
 const before=contentHash(proposal),p=projectFeedbackPublication(input,proposal);
 expect(p.feedback).toEqual({strengths:[],improvements:['补充同步起跑的验证步骤']});
 expect(p.publication.withheldCount).toBe(2);expect(p.publication.qualityClaimEligible).toBe(false);
 expect(JSON.stringify(p)).not.toContain('正确最大成功数应为99');expect(contentHash(proposal)).toBe(before);
});
test('unmatched profile and unknown wording stay draft, never verified',()=>{
 const i=structuredClone(input);i.question.text+='版本变化';const p=projectFeedbackPublication(i,proposal);
 expect(p.publication.items.find(i=>i.kind==='improvements'&&i.index===0)?.reason).toBe('not-independently-reviewed');
 expect(p.feedback.improvements).toContain('正确最大成功数应为99。');
});
test('authorized cue review emits source-bound candidate receipt, can replay, and never certifies quality',()=>{
 const h=host(),c=command('release-unverified'),r=proposeFeedbackReview(input,proposal,[],c,h);
 expect(r.receipt.kind).toBe('uncommitted-feedback-review-receipt');expect(r.projection.feedback.strengths).toEqual(proposal.feedback.strengths);
 expect(r.projection.publication.qualityClaimEligible).toBe(false);expect(r.projection.publication.reviewVersion).toBe(1);
 expect(proposeFeedbackReview(input,proposal,[r.receipt],c,h).receipt).toEqual(r.receipt);
});
test('known contradiction cannot be released and unauthorized or stale commands fail',()=>{
 expect(()=>proposeFeedbackReview(input,proposal,[],command('release-unverified',1),host())).toThrow();
 expect(()=>proposeFeedbackReview(input,proposal,[],command('withhold'),{...host(),authorizedReviewerIds:[]})).toThrow();
 expect(()=>proposeFeedbackReview(input,proposal,[],{...command('withhold'),expectedVersion:1},host())).toThrow();
 expect(()=>proposeFeedbackReview(input,proposal,[],command('withhold'),{...host(),userId:'someone-else'})).toThrow();
});
test('receipts cannot cross answers, feedback edits, policy versions or conflicting request replays',()=>{
 const h=host(),c=command('withhold'),r=proposeFeedbackReview(input,proposal,[],c,h);
 const changed=structuredClone(proposal);changed.feedback.improvements[1]='改过的反馈';
 expect(()=>projectFeedbackPublication(input,changed,[r.receipt],h)).toThrow();
 expect(()=>projectFeedbackPublication(input,proposal,[{...r.receipt,policyVersion:'other'}],h)).toThrow();
 expect(()=>proposeFeedbackReview(input,proposal,[r.receipt],{...c,note:'changed'},h)).toThrow();
});
test('receipt tampering, future timestamps and missing host authority fail closed',()=>{
 const h=host(),r=proposeFeedbackReview(input,proposal,[],command('withhold'),h);
 expect(()=>projectFeedbackPublication(input,proposal,[r.receipt])).toThrow();
 expect(()=>projectFeedbackPublication(input,proposal,[{...r.receipt,note:'altered'}],h)).toThrow();
 expect(()=>projectFeedbackPublication(input,proposal,[r.receipt],{...h,now:r.receipt.issuedAt-1})).toThrow();
 expect(()=>projectFeedbackPublication(input,proposal,[r.receipt,r.receipt],h)).toThrow();
});
test('projection states are coherent and review authority cannot be smuggled through model or command fields',()=>{
 const p=projectFeedbackPublication(input,proposal);
 expect(FeedbackPublicationSchema.safeParse({...p.publication,withheldCount:0}).success).toBe(false);
 expect(FeedbackReviewCommandSchema.safeParse({...command('withhold'),reviewerId:'admin'}).success).toBe(false);
 expect(EvaluationOutputSchema.safeParse({evidence:[],criterionScores:[],feedback:proposal.feedback,feedbackPublication:p.publication}).success).toBe(false);
});
test('all-withheld feedback stays empty without invented placeholder advice',async()=>{
 const changed=structuredClone(proposal);changed.feedback.improvements=['正确最大成功数应为99。'];
 const p=projectFeedbackPublication(input,changed);expect(p.feedback).toEqual({strengths:[],improvements:[]});expect(p.publication.disposition).toBe('withheld');
 const report=await buildInterviewReport({state:changed.nextState,generatedAt:changed.nextState.observations.at(-1)!.observedAt+1,policyVersion:'v0',skillLabels:Object.fromEntries(input.state.skills.map(s=>[s.skillId,s.skillId])),turns:[{input,proposal:changed,evidenceMode:'offline-fixture'}]});
 expect(report.assessments[0]!.feedback).toEqual(p.feedback);expect(report.warnings).toContain('feedback_items_withheld_pending_review');
});
test('report displays filtered feedback with publication metadata; raw turns and score remain intact',async()=>{
 const report=await buildInterviewReport({state:proposal.nextState,generatedAt:proposal.nextState.observations.at(-1)!.observedAt+1,policyVersion:'v0',skillLabels:Object.fromEntries(input.state.skills.map(s=>[s.skillId,s.skillId])),turns:[{input,proposal,evidenceMode:'offline-fixture'}]});
 expect(report.assessments[0]!.feedback.improvements).toEqual(['补充同步起跑的验证步骤']);
 expect(report.assessments[0]!.feedbackPublication?.withheldCount).toBe(2);expect(report.assessments[0]!.evaluation).toEqual(proposal.evaluation);
 const forged=structuredClone(report);forged.assessments[0]!.feedback.strengths.push('伪造发布');expect(ContentReportSchema.safeParse(forged).success).toBe(false);
 expect(proposal.feedback.improvements).toContain('正确最大成功数应为99。');
});
