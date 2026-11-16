import { test,expect } from 'bun:test';
import { createReviewLedger,recordSemanticReview,inspectReviewLedger,reviewOperationTemplate } from '../evals/answers/semantic/reviews.ts';
import { contentHash } from '../evals/answers/validation.ts';
function setup(){const ledger=createReviewLedger(1000),v=inspectReviewLedger(ledger).claims[0]!;
 const op={operationId:'op',expectedLedgerVersion:0,claimId:v.claimId,expectedLabelVersion:0,requestDigest:v.requestDigest,labelDigest:v.labelDigest,occurredAt:2000,
  action:{kind:'review_label',decision:'approved',checks:{literalMatch:true,criterionAlignment:true,scoreSupport:true},note:'合成边界测试'}};
 return{ledger,op};}
test('empty templates, imported actor fields, fake human count and changed operation replay are rejected',()=>{
 const{ledger,op}=setup();
 expect(()=>recordSemanticReview(ledger,reviewOperationTemplate(ledger).operations[0],{actorId:'r',now:2000})).toThrow('SEMANTIC_REVIEW_INVALID');
 expect(()=>recordSemanticReview(ledger,{...op,actorId:'impersonated'},{actorId:'r',now:2000})).toThrow('SEMANTIC_REVIEW_INVALID');
 expect(()=>inspectReviewLedger({...ledger,humanReferenceCount:8})).toThrow('SEMANTIC_REVIEW_INVALID');
 const one=recordSemanticReview(ledger,op,{actorId:'r',now:2000});
 expect(()=>recordSemanticReview(one,op,{actorId:'other',now:2001})).toThrow('SEMANTIC_REVIEW_CONFLICT');
 expect(()=>recordSemanticReview(one,{...op,action:{...op.action,note:'changed'}},{actorId:'r',now:2001})).toThrow('SEMANTIC_REVIEW_CONFLICT');
});
test('stale datasets are held, while altered baseline content cannot self-sign into the current dataset',()=>{
 const{ledger,op}=setup(),stale=structuredClone(ledger);stale.datasetDigest='0'.repeat(64);const{digest,...body}=stale;stale.digest=contentHash(body);
 expect(inspectReviewLedger(stale).binding).toBe('stale');expect(inspectReviewLedger(stale).claims.every(c=>c.status==='stale_held')).toBe(true);
 expect(()=>recordSemanticReview(stale,op,{actorId:'r',now:2000})).toThrow('SEMANTIC_REVIEW_STALE');
 const forged=structuredClone(ledger);forged.baseline[0]!.reference.verdict='insufficient';forged.baseline[0]!.referenceDigest=contentHash(forged.baseline[0]!.reference);
 const{digest:old,...changed}=forged;forged.digest=contentHash(changed);expect(()=>inspectReviewLedger(forged)).toThrow('SEMANTIC_REVIEW_INVALID');
});
test('request and label digests, time and repeat-review constraints remain enforced',()=>{
 const{ledger,op}=setup();
 expect(()=>recordSemanticReview(ledger,{...op,requestDigest:'0'.repeat(64)},{actorId:'r',now:2000})).toThrow('SEMANTIC_REVIEW_STALE');
 expect(()=>recordSemanticReview(ledger,{...op,labelDigest:'0'.repeat(64)},{actorId:'r',now:2000})).toThrow('SEMANTIC_REVIEW_STALE');
 expect(()=>recordSemanticReview(ledger,op,{actorId:'r',now:1999})).toThrow('SEMANTIC_REVIEW_INVALID');
 const one=recordSemanticReview(ledger,op,{actorId:'r',now:2000});
 expect(()=>recordSemanticReview(one,{...op,operationId:'again',expectedLedgerVersion:1},{actorId:'r',now:2001})).toThrow('SEMANTIC_REVIEW_CONFLICT');
 expect(inspectReviewLedger(one).humanReferenceCount).toBe(0);
});
