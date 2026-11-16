import {z} from 'zod';
import {RoleIdSchema} from './tools.ts';
const id=z.string().trim().min(1).max(100),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const FeedbackPublicationRevisionContextSchema=z.object({revisionDigest:digest}).strict();
export const FeedbackReviewCommandSchema=z.object({requestId:id,sourceDigest:digest,expectedVersion:z.number().int().nonnegative(),
 itemIndex:z.number().int().min(0).max(9),decision:z.enum(['withhold','release-unverified']),note:z.string().trim().min(1).max(1000)}).strict();
export const FeedbackReviewReceiptSchema=z.object({kind:z.literal('uncommitted-feedback-review-receipt'),policyVersion:z.literal('feedback-publication-v1'),
 authority:z.literal('host-declared-unverified'),identityVerified:z.literal(false),requestId:id,sourceDigest:digest,itemDigest:digest,
 userId:id,roleId:RoleIdSchema,sessionId:id,reviewerId:id,issuedAt:z.number().int().nonnegative(),version:z.number().int().positive(),
 itemIndex:z.number().int().min(0).max(9),decision:FeedbackReviewCommandSchema.shape.decision,note:FeedbackReviewCommandSchema.shape.note,digest}).strict();
export const FeedbackPublicationSchema=z.object({version:z.literal(1),policyVersion:z.literal('feedback-publication-v1'),sourceDigest:digest,
 revisionDigest:digest.optional(),
 disposition:z.enum(['draft-unverified','partially-withheld','withheld']),withheldCount:z.number().int().min(0).max(10),reviewVersion:z.number().int().nonnegative(),
 qualityClaimEligible:z.literal(false),semanticSupport:z.literal('not_verified'),
 items:z.array(z.object({kind:z.enum(['strengths','improvements']),index:z.number().int().min(0).max(4),itemDigest:digest,
  status:z.enum(['draft-unverified','reviewed-unverified','withheld']),reason:z.enum(['fact-contradiction','citation-review-required','not-independently-reviewed','review-withheld','review-release-unverified']),
  receiptDigest:digest.optional()}).strict()).max(10)}).strict().superRefine((p,ctx)=>{
 const count=p.items.filter(i=>i.status==='withheld').length;
 if(p.withheldCount!==count||p.disposition!==(count===0?'draft-unverified':count===p.items.length?'withheld':'partially-withheld')||
  new Set(p.items.map(i=>i.kind+':'+i.index)).size!==p.items.length||
  (['strengths','improvements'] as const).some(k=>p.items.filter(i=>i.kind===k).some((i,n)=>i.index!==n))||
  p.items.some(i=>(i.reason.startsWith('review-'))!==(i.receiptDigest!==undefined)||
   (i.status==='withheld')!==['fact-contradiction','citation-review-required','review-withheld'].includes(i.reason)||
   (i.status==='reviewed-unverified')!==(i.reason==='review-release-unverified')))
 ctx.addIssue({code:'custom',message:'Feedback publication states must agree.'});
});
export const DisplayFeedbackSchema=z.object({strengths:z.array(z.string().min(1).max(500)).max(5),improvements:z.array(z.string().min(1).max(500)).max(5)}).strict();
export type FeedbackReviewReceipt=z.infer<typeof FeedbackReviewReceiptSchema>;
export type FeedbackPublication=z.infer<typeof FeedbackPublicationSchema>;
