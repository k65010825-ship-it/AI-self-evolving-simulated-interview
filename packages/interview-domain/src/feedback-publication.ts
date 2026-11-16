import {createHash} from 'node:crypto';
import {z} from 'zod';
import {TurnInputSchema,TurnProposalSchema} from '../../contracts/src/evaluation.ts';
import {FeedbackPublicationSchema,FeedbackReviewCommandSchema,FeedbackReviewReceiptSchema,FeedbackPublicationRevisionContextSchema,type FeedbackReviewReceipt} from '../../contracts/src/feedback-publication.ts';
import {RoleIdSchema} from '../../contracts/src/tools.ts';
import {reviewFeedback} from './feedback-review.ts';

const policyVersion='feedback-publication-v1' as const;
const canonical=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical((v as Record<string,unknown>)[k])}`).join(',')}}`;
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const hostSchema=z.object({userId:z.string().min(1),roleId:RoleIdSchema,sessionId:z.string().min(1),reviewerId:z.string().min(1),authorizedReviewerIds:z.array(z.string().min(1)).max(100),now:z.number().int().nonnegative()}).strict();
export type FeedbackReviewHost=z.infer<typeof hostSchema>;
function fail():never{throw Error('FEEDBACK_PUBLICATION_INVALID');}
function source(rawInput:unknown,rawProposal:unknown,rawRevision?:unknown){
 const input=TurnInputSchema.parse(rawInput),proposal=TurnProposalSchema.parse(rawProposal),review=reviewFeedback(input,proposal);
 if([input.state.roleId,input.question.roleId,input.rubric.roleId,proposal.nextState.roleId].some(r=>r!==input.context.roleId)||input.state.version!==input.expectedVersion||proposal.nextState.sessionId!==input.state.sessionId||proposal.nextState.version!==input.expectedVersion+1)fail();
 const revision=rawRevision===undefined?undefined:FeedbackPublicationRevisionContextSchema.parse(rawRevision);
 return {input,proposal,review,revision,sourceDigest:hash({policyVersion,input,proposal,...(revision?{revision}: {})})};
}
/** Caller supplies authenticated authority and trusted stored receipts, never model arguments.
 * These pure functions emit candidates, not authenticated/persisted business decisions. */
export function projectFeedbackPublication(rawInput:unknown,rawProposal:unknown,rawReceipts:unknown=[],rawHost?:unknown,rawRevision?:unknown){
 const s=source(rawInput,rawProposal,rawRevision),receipts=FeedbackReviewReceiptSchema.array().max(200).parse(rawReceipts);
 const host=rawHost===undefined?undefined:hostSchema.parse(rawHost);
 if(receipts.length&&!host)fail();
 if(host&&(host.userId!==s.input.context.userId||host.roleId!==s.input.context.roleId||host.sessionId!==s.input.state.sessionId))fail();
 const decisions=new Map<number,FeedbackReviewReceipt>(),seen=new Set<string>();
 for(const [index,r] of receipts.entries()){
  const {digest,...body}=r,item=s.review.items[r.itemIndex];
  if(!host||!item||r.sourceDigest!==s.sourceDigest||r.itemDigest!==hash(item)||hash(body)!==digest||r.version!==index+1||seen.has(r.requestId)||
   r.userId!==host.userId||r.roleId!==host.roleId||r.sessionId!==host.sessionId||!host.authorizedReviewerIds.includes(r.reviewerId)||r.issuedAt>host.now||
   r.issuedAt<(s.proposal.nextState.observations.at(-1)?.observedAt??0)||
   (index>0&&r.issuedAt<receipts[index-1]!.issuedAt)||r.decision==='release-unverified'&&item.fact.status==='contradiction')fail();
  seen.add(r.requestId);decisions.set(r.itemIndex,r);
 }
 const feedback:{strengths:string[];improvements:string[]}={strengths:[],improvements:[]};
 const items=s.review.items.map((i,index)=>{
  const r=decisions.get(index),reason=r?(r.decision==='withhold'?'review-withheld' as const:'review-release-unverified' as const):
   i.fact.status==='contradiction'?'fact-contradiction' as const:i.concern?'citation-review-required' as const:'not-independently-reviewed' as const;
  const status=['fact-contradiction','citation-review-required','review-withheld'].includes(reason)?'withheld' as const:r?'reviewed-unverified' as const:'draft-unverified' as const;
  if(status!=='withheld')feedback[i.kind].push(i.text);
  return {kind:i.kind,index:i.index,itemDigest:hash(i),status,reason,...(r?{receiptDigest:r.digest}:{})};
 });
 const withheldCount=items.filter(i=>i.status==='withheld').length;
 const publication=FeedbackPublicationSchema.parse({version:1,policyVersion,sourceDigest:s.sourceDigest,disposition:withheldCount===0?'draft-unverified':withheldCount===items.length?'withheld':'partially-withheld',
  ...(s.revision?{revisionDigest:s.revision.revisionDigest}:{}),
  withheldCount,reviewVersion:receipts.length,qualityClaimEligible:false,semanticSupport:'not_verified',items});
 return {feedback,publication};
}
export function proposeFeedbackReview(rawInput:unknown,rawProposal:unknown,rawReceipts:unknown,rawCommand:unknown,rawHost:unknown,rawRevision?:unknown){
 const s=source(rawInput,rawProposal,rawRevision),c=FeedbackReviewCommandSchema.parse(rawCommand),host=hostSchema.parse(rawHost);
 const receipts=FeedbackReviewReceiptSchema.array().max(200).parse(rawReceipts);
 projectFeedbackPublication(s.input,s.proposal,receipts,host,s.revision);
 if(!host.authorizedReviewerIds.includes(host.reviewerId)||c.sourceDigest!==s.sourceDigest)fail();
 const existing=receipts.find(r=>r.requestId===c.requestId);
 if(existing){
  if(existing.reviewerId!==host.reviewerId||existing.version!==c.expectedVersion+1||existing.itemIndex!==c.itemIndex||existing.decision!==c.decision||existing.note!==c.note)fail();
  return {receipt:structuredClone(existing),projection:projectFeedbackPublication(s.input,s.proposal,receipts,host,s.revision)};
 }
 if(c.expectedVersion!==receipts.length||receipts.length>=200)fail();const item=s.review.items[c.itemIndex];if(!item)fail();
 const body={kind:'uncommitted-feedback-review-receipt',policyVersion,authority:'host-declared-unverified',identityVerified:false,
  requestId:c.requestId,sourceDigest:s.sourceDigest,itemDigest:hash(item),userId:host.userId,roleId:host.roleId,sessionId:host.sessionId,reviewerId:host.reviewerId,
  issuedAt:host.now,version:receipts.length+1,itemIndex:c.itemIndex,decision:c.decision,note:c.note};
 const receipt=FeedbackReviewReceiptSchema.parse({...body,digest:hash(body)});
 return {receipt,projection:projectFeedbackPublication(s.input,s.proposal,[...receipts,receipt],host,s.revision)};
}
