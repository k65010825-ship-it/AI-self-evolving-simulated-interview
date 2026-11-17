import {z} from 'zod';import {RoleIdSchema} from './tools.ts';
const id=z.string().min(1).max(100),time=z.number().int().nonnegative();
export const HintIssueIdSchema=z.string().regex(/^[a-f0-9]{64}$/);
export const HintAssistanceSchema=z.object({kind:z.literal('hint-assisted'),issueId:HintIssueIdSchema,hintVersion:z.literal('coaching-v1'),
 receiptIds:z.array(id).min(1).max(2).refine(a=>new Set(a).size===a.length)}).strict();
export const HintBindingSchema=z.object({userId:id,roleId:RoleIdSchema,sessionId:id,issueId:HintIssueIdSchema,questionId:id,issuedAt:time}).strict();
const entry=z.object({operationId:id,level:z.number().int().min(1).max(2),reservedAt:time,updatedAt:time});
export const HintEntrySchema=z.discriminatedUnion('status',[
 entry.extend({status:z.literal('reserved')}).strict(),entry.extend({status:z.literal('released')}).strict(),
 entry.extend({status:z.literal('committed'),text:z.string().trim().min(1).max(1000),hintVersion:z.literal('coaching-v1')}).strict(),
]);
export const HintJournalSchema=z.object({schemaVersion:z.literal(1),binding:HintBindingSchema,limit:z.literal(2),
 version:z.number().int().nonnegative(),entries:z.array(HintEntrySchema).max(128)}).strict().superRefine((s,ctx)=>{
 let committed=0,reserved=0,last=s.binding.issuedAt,version=0,invalid=new Set(s.entries.map(e=>e.operationId)).size!==s.entries.length;
 for(const e of s.entries){
  if(e.reservedAt<last||e.updatedAt<e.reservedAt||e.level!==committed+1||reserved)invalid=true;
  if(e.status==='committed')committed++;if(e.status==='reserved')reserved++;
  last=e.updatedAt;version+=e.status==='reserved'?1:2;
 }
 if(committed+reserved>2||version!==s.version)invalid=true;
 if(invalid)ctx.addIssue({code:'custom',message:'Invalid hint journal transition history.'});
});
export const HintRequestSchema=z.object({operationId:id,sessionId:id,issueId:HintIssueIdSchema,expectedRevision:z.number().int().nonnegative()}).strict();
export const HintStatusInputSchema=z.object({sessionId:id}).strict();
export const HintStatusSchema=z.discriminatedUnion('available',[
 z.object({available:z.literal(false),reason:z.enum(['HINT_STORAGE_UNAVAILABLE','NO_CURRENT_QUESTION']),issueId:z.null(),used:z.null(),remaining:z.null()}).strict(),
 z.object({available:z.literal(true),reason:z.null(),issueId:HintIssueIdSchema,used:z.number().int().min(0).max(2),remaining:z.number().int().min(0).max(2),reserved:z.boolean(),hintVersion:z.literal('coaching-v1')}).strict(),
]);
export const HintReceiptSchema=z.object({operationId:id,sessionId:id,issueId:HintIssueIdSchema,questionId:id,
 level:z.number().int().min(1).max(2),remaining:z.number().int().min(0).max(1),text:z.string().min(1).max(1000),hintVersion:z.literal('coaching-v1'),
 assisted:z.literal(true)}).strict();
export type HintBinding=z.infer<typeof HintBindingSchema>;export type HintJournal=z.infer<typeof HintJournalSchema>;
export type HintAssistance=z.infer<typeof HintAssistanceSchema>;
/** A clarification may gain hints, but cannot drop or replace already supplied assistance. */
export function isAssistanceContinuation(before:HintAssistance|undefined,after:HintAssistance|undefined){
 return !before||!!after&&before.issueId===after.issueId&&before.hintVersion===after.hintVersion&&before.receiptIds.every((id,i)=>after.receiptIds[i]===id);
}
