import { test,expect } from 'bun:test';
import { createReviewLedger,recordSemanticReview,inspectReviewLedger } from '../evals/answers/semantic/reviews.ts';
import type { SemanticReviewOperation } from '../packages/contracts/src/semantic-review.ts';
function operation(ledger:ReturnType<typeof createReviewLedger>,id:string,kind:'review'|'revise'='review'):SemanticReviewOperation{
 const view=inspectReviewLedger(ledger).claims[0]!;
 return{operationId:id,expectedLedgerVersion:ledger.version,claimId:view.claimId,expectedLabelVersion:view.labelVersion,requestDigest:view.requestDigest,
  labelDigest:view.labelDigest,occurredAt:2000,action:kind==='review'?{kind:'review_label',decision:'approved',checks:{literalMatch:true,criterionAlignment:true,scoreSupport:true},note:'本地测试复核声明，不是实际人工审核'}:
   {kind:'revise_label',reference:{verdict:'insufficient',rationale:'修订草案解释，需独立复核'},changeReason:'测试修订'}};
}
test('revision invalidates old review; operations replay exactly and cannot silently overwrite versions',()=>{
 const base=createReviewLedger(1000),op=operation(base,'review-a');
 const one=recordSemanticReview(base,op,{actorId:'reviewer-a',now:2000});
 expect(inspectReviewLedger(one).claims[0]!.status).toBe('declared_approved');
 expect(recordSemanticReview(one,op,{actorId:'reviewer-a',now:2001})).toEqual(one);
 const revised=recordSemanticReview(one,operation(one,'revision-a','revise'),{actorId:'author-b',now:2001});
 const view=inspectReviewLedger(revised);expect(view.claims[0]!.labelVersion).toBe(1);expect(view.claims[0]!.status).toBe('unreviewed');
 expect(view.humanReferenceCount).toBe(0);expect(view.qualityClaimEligible).toBe(false);
 expect(()=>recordSemanticReview(revised,{...op,operationId:'stale-new-id'},{actorId:'reviewer-a',now:2002})).toThrow('SEMANTIC_REVIEW_CONFLICT');
});
test('contrary reviews create dispute; self-review and missing approval checks cannot pass',()=>{
 const base=createReviewLedger(1000),one=recordSemanticReview(base,operation(base,'a'),{actorId:'reviewer-a',now:2000});
 const other=operation(one,'b');other.action={kind:'review_label',decision:'changes_requested',checks:{literalMatch:true,criterionAlignment:false,scoreSupport:false},note:'需要修订证据支持标签'};
 const two=recordSemanticReview(one,other,{actorId:'reviewer-b',now:2001});expect(inspectReviewLedger(two).claims[0]!.status).toBe('disputed');
 const revised=recordSemanticReview(two,operation(two,'c','revise'),{actorId:'author',now:2002});
 expect(()=>recordSemanticReview(revised,operation(revised,'self'),{actorId:'author',now:2003})).toThrow('SEMANTIC_REVIEW_SELF_REVIEW');
 const bad=operation(revised,'bad');if(bad.action.kind==='review_label')bad.action.checks.scoreSupport=false;
 expect(()=>recordSemanticReview(revised,bad,{actorId:'other',now:2003})).toThrow('SEMANTIC_REVIEW_CHECKS_FAILED');
});
