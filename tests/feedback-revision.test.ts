import {beforeAll,expect,test} from 'bun:test';
import {runContentRubricsDemo} from '../scripts/demo-content-rubrics.ts';
import {createFeedbackRevisionHistory,proposeFeedbackRevision,replayFeedbackRevisions} from '../packages/interview-domain/src/feedback-revision.ts';
import {projectFeedbackPublication,proposeFeedbackReview} from '../packages/interview-domain/src/feedback-publication.ts';
import type {TurnInput,TurnProposal} from '../packages/contracts/src/evaluation.ts';
import {FeedbackRevisionCommandSchema} from '../packages/contracts/src/feedback-revision.ts';
import {contentHash} from '../evals/answers/validation.ts';
let input:TurnInput,proposal:TurnProposal;
beforeAll(async()=>{const d=await runContentRubricsDemo(),t=d.reportInput.turns[0]!;input=t.input;proposal=structuredClone(t.proposal);proposal.feedback={strengths:['认识竞态并发窗口'],improvements:['原始待审改进建议']};});
const host=()=>({userId:input.context.userId,roleId:input.context.roleId,sessionId:input.state.sessionId,editorId:'synthetic-editor',authorizedEditorIds:['synthetic-editor'],now:Date.now()});
const initial=()=>createFeedbackRevisionHistory(input,proposal);
const command=(history=initial())=>({requestId:'revision-1',expectedVersion:history.records.length,expectedHeadDigest:history.headSourceDigest,feedback:{strengths:[],improvements:['修订后的练习建议，仍待独立核对']},note:'synthetic test, not expert approval'});

test('revision changes feedback only, keeps original and re-evaluates publication without review receipts',()=>{
 const h=initial(),before=contentHash({input,proposal,h}),r=proposeFeedbackRevision(input,proposal,h,command(h),host());
 expect(r.history.records).toHaveLength(1);expect(r.replay.currentProposal.feedback).toEqual(command(h).feedback);
 const {feedback:a,...original}=proposal,{feedback:b,...revised}=r.replay.currentProposal;void a;void b;expect(revised).toEqual(original);
 expect(contentHash({input,proposal,h})).toBe(before);expect(r.replay.versions).toHaveLength(2);expect(r.replay.projection.publication.reviewVersion).toBe(0);
 expect(r.replay.projection.publication.qualityClaimEligible).toBe(false);
});
test('JSON round trip restores version chain, revisiting an old version is read-only',()=>{
 const h=host(),first=proposeFeedbackRevision(input,proposal,initial(),command(),h);
 const second=proposeFeedbackRevision(input,proposal,first.history,{...command(first.history),requestId:'revision-2',feedback:proposal.feedback},h);
 const replay=replayFeedbackRevisions(input,proposal,JSON.parse(JSON.stringify(second.history)),h);
 expect(replay.versions[0]!.feedback).toEqual(proposal.feedback);expect(replay.versions[2]!.feedback).toEqual(proposal.feedback);
 expect(replay.currentProposal.evaluation).toEqual(proposal.evaluation);expect(replay.projection.publication.withheldCount).toBeGreaterThan(0);
 expect(replay.projection.publication.sourceDigest).not.toBe(projectFeedbackPublication(input,proposal).publication.sourceDigest);
});
test('identical request is idempotent; stale head, changed request, no-op and unauthorized scope fail',()=>{
 const h=host(),c=command(),r=proposeFeedbackRevision(input,proposal,initial(),c,h);
 expect(proposeFeedbackRevision(input,proposal,r.history,c,h).history).toEqual(r.history);
 expect(()=>proposeFeedbackRevision(input,proposal,r.history,{...c,note:'different'},h)).toThrow();
 expect(()=>proposeFeedbackRevision(input,proposal,r.history,{...c,requestId:'stale'},h)).toThrow();
 expect(()=>proposeFeedbackRevision(input,proposal,initial(),{...c,feedback:proposal.feedback},h)).toThrow();
 expect(()=>proposeFeedbackRevision(input,proposal,initial(),c,{...h,authorizedEditorIds:[]})).toThrow();
 expect(()=>proposeFeedbackRevision(input,proposal,initial(),c,{...h,userId:'other'})).toThrow();
});
test('origin edits, broken chain and mutated records are rejected, not silently normalized',()=>{
 const h=host(),r=proposeFeedbackRevision(input,proposal,initial(),command(),h),changed=structuredClone(proposal);changed.feedback.improvements=['different original'];
 expect(()=>replayFeedbackRevisions(input,changed,r.history,h)).toThrow();
 const bad=structuredClone(r.history);bad.records[0]!.feedback.improvements=['forged'];expect(()=>replayFeedbackRevisions(input,proposal,bad,h)).toThrow();
 expect(()=>replayFeedbackRevisions(input,proposal,{...r.history,records:[]},h)).toThrow();
 expect(()=>replayFeedbackRevisions(input,proposal,r.history,{...h,now:r.history.records[0]!.createdAt-1})).toThrow();
});
test('old review receipts cannot release feedback on a revised proposal',()=>{
 const pub=projectFeedbackPublication(input,proposal),h=host();
 const receipt=proposeFeedbackReview(input,proposal,[],{requestId:'old-review',sourceDigest:pub.publication.sourceDigest,expectedVersion:0,itemIndex:0,decision:'release-unverified',note:'synthetic review'},
  {userId:h.userId,roleId:h.roleId,sessionId:h.sessionId,reviewerId:h.editorId,authorizedReviewerIds:h.authorizedEditorIds,now:h.now}).receipt;
 const r=proposeFeedbackRevision(input,proposal,initial(),command(),h);
 const back=proposeFeedbackRevision(input,proposal,r.history,{...command(r.history),requestId:'return-old-text',feedback:proposal.feedback},h);
 expect(back.replay.currentProposal.feedback).toEqual(proposal.feedback);
 expect(()=>projectFeedbackPublication(input,back.replay.currentProposal,[receipt],{userId:h.userId,roleId:h.roleId,sessionId:h.sessionId,reviewerId:h.editorId,authorizedReviewerIds:h.authorizedEditorIds,now:h.now},back.replay.revisionContext)).toThrow();
});
test('revision command never accepts score, evidence or identity updates',()=>{
 for(const extra of [{evaluation:proposal.evaluation},{evidence:proposal.evidence},{editorId:'admin'},{nextState:proposal.nextState}])
  expect(FeedbackRevisionCommandSchema.safeParse({...command(),...extra}).success).toBe(false);
});
test('version history is bounded but existing requests can still replay at the cap',()=>{
 const h=host();let history=initial();let last=command(history);
 for(let i=0;i<20;i++){last={...command(history),requestId:'cap-'+i,feedback:{strengths:[],improvements:['bounded draft '+i]}};history=proposeFeedbackRevision(input,proposal,history,last,h).history;}
 expect(proposeFeedbackRevision(input,proposal,history,last,h).history).toEqual(history);
 expect(()=>proposeFeedbackRevision(input,proposal,history,{...command(history),requestId:'overflow'},h)).toThrow();
});
