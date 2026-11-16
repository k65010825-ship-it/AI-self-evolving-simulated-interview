import {z} from 'zod';
/** No upstream strings, text, lengths, hashes, headers or request identifiers. */
export const WireCompletionSchema=z.object({doneSeen:z.boolean(),
 finish:z.enum(['missing','stop','length','toolUse','other','conflicting']),framing:z.enum(['valid','invalid']),
 textMatch:z.enum(['matched','mismatched','unavailable']),sdkStop:z.enum(['stop','length','toolUse','error','aborted','other']),
 comparisonScope:z.enum(['upstream-to-sdk','host-continuation-not-compared'])}).strict().superRefine((v,ctx)=>{
 if((!v.doneSeen||v.framing==='invalid'||v.comparisonScope==='host-continuation-not-compared')&&v.textMatch!=='unavailable')ctx.addIssue({code:'custom',message:'Incomplete or synthetic boundaries cannot claim text equality.'});
});
export type WireCompletion=z.infer<typeof WireCompletionSchema>;
