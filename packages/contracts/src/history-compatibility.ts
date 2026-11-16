import { z } from 'zod';
const id=z.string().trim().min(1).max(100),count=z.number().int().min(0).max(4000);
/** Host-pinned exact allow-list; never a model assertion of rubric equivalence. */
export const HistoryCompatibilityPolicySchema=z.object({id,mode:z.literal('strict'),
 allowed:z.array(z.object({skillId:id,rubricId:id,rubricVersion:id}).strict()).max(200)
  .refine(a=>new Set(a.map(r=>JSON.stringify([r.skillId,r.rubricId,r.rubricVersion]))).size===a.length)}).strict();
export const HistoryCompatibilityAuditSchema=z.object({mode:z.enum(['strict','legacy-unchecked']),policyId:id.nullable(),
 sourceCount:count,eligibleCount:count,excludedCount:count,authority:z.literal('host-declared-unverified'),compatibilityVerified:z.literal(false)}).strict()
 .superRefine((a,ctx)=>{if(a.sourceCount!==a.eligibleCount+a.excludedCount||(a.mode==='strict')!==(a.policyId!==null)
  ||a.mode==='legacy-unchecked'&&a.excludedCount!==0)ctx.addIssue({code:'custom',message:'Invalid history compatibility counts or policy.'});});
export type HistoryCompatibilityPolicy=z.infer<typeof HistoryCompatibilityPolicySchema>;
