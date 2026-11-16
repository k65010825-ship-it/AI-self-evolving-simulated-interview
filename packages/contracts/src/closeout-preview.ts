import {z} from 'zod';
import {WorkflowSchema} from './session-workflow.ts';
import {FeedbackRevisionHistorySchema} from './feedback-revision.ts';
import {ContentReportSchema} from './report.ts';
const id=z.string().min(1).max(100),digest=z.string().regex(/^[a-f0-9]{64}$/),version=z.number().int().min(0).max(20);
export const CloseoutPreviewInputSchema=z.object({snapshot:WorkflowSchema,expectedSnapshotDigest:digest,
 selections:z.array(z.object({answerId:id,history:FeedbackRevisionHistorySchema,version}).strict()).max(20)}).strict().superRefine((i,ctx)=>{
 if(new Set(i.selections.map(s=>s.answerId)).size!==i.selections.length)ctx.addIssue({code:'custom',message:'Duplicate preview answer.'});
});
export const CloseoutPreviewSchema=z.object({kind:z.literal('uncommitted-closeout-preview'),version:z.literal(1),generatedAt:z.number().int().nonnegative(),
 basedOn:z.object({snapshotDigest:digest,reportDigest:digest,sessionId:id,workflowRevision:z.number().int().nonnegative(),stateVersion:z.number().int().nonnegative(),
  selections:z.array(z.object({answerId:id,historyDigest:digest,headVersion:version,selectedVersion:version,selectedSourceDigest:digest,revisionDigest:digest.optional()}).strict()).max(20)}).strict(),
 report:ContentReportSchema,readOnly:z.literal(true),formalCommitted:z.literal(false),qualityClaimEligible:z.literal(false),identityVerified:z.literal(false),liveModelCalls:z.literal(0)
}).strict().superRefine((p,ctx)=>{
 if(p.report.sessionId!==p.basedOn.sessionId||p.report.sessionVersion!==p.basedOn.stateVersion||p.generatedAt<p.report.generatedAt||
  new Set(p.basedOn.selections.map(s=>s.answerId)).size!==p.basedOn.selections.length||p.basedOn.selections.some(s=>{
   const a=p.report.assessments.find(a=>a.answerId===s.answerId);return s.selectedVersion>s.headVersion||!a||a.feedbackPublication?.sourceDigest!==s.selectedSourceDigest||a.feedbackPublication?.revisionDigest!==s.revisionDigest;
  }))
 ctx.addIssue({code:'custom',message:'Preview source binding mismatch.'});
});
export type CloseoutPreviewInput=z.infer<typeof CloseoutPreviewInputSchema>;
export type CloseoutPreview=z.infer<typeof CloseoutPreviewSchema>;
