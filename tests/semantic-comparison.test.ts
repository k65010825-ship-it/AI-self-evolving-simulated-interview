import { test,expect } from 'bun:test';
import { createReviewLedger,inspectReviewLedger,recordSemanticReview } from '../evals/answers/semantic/reviews.ts';
import { createSemanticComparison,verifySemanticComparison } from '../evals/answers/semantic/comparison.ts';
import { runSemanticBenchmark } from '../evals/answers/semantic/runner.ts';
import { contentHash } from '../evals/answers/validation.ts';
import type { SemanticReviewOperation } from '../packages/contracts/src/semantic-review.ts';

function change(l:ReturnType<typeof createReviewLedger>,kind:'revise'|'approve'|'dispute',id:string,actor:string){
 const c=inspectReviewLedger(l).claims[0]!;
 const op:SemanticReviewOperation={operationId:id,expectedLedgerVersion:l.version,claimId:c.claimId,expectedLabelVersion:c.labelVersion,requestDigest:c.requestDigest,labelDigest:c.labelDigest,occurredAt:2000,
 action:kind==='revise'?{kind:'revise_label',reference:{verdict:'insufficient',rationale:'合成修订，不是真实审核'},changeReason:'测试对照'}:
 {kind:'review_label',decision:kind==='approve'?'approved':'changes_requested',checks:{literalMatch:true,criterionAlignment:true,scoreSupport:true},note:'合成测试声明'}};
 return recordSemanticReview(l,op,{actorId:actor,now:2000});
}
const predict=()=>runSemanticBenchmark({judge:async()=>({verdict:'supported'})});

test('comparison reuses every prediction, only declared-reviewed revisions replace labels; no input mutation or authority upgrade',async()=>{
 const r=await predict(),base=createReviewLedger(1000),revision=change(base,'revise','edit','author');
 const before=JSON.stringify({r,revision}),draft=createSemanticComparison(r,revision);
 expect(draft.adoptedCount).toBe(0);expect(draft.candidate).toEqual(draft.baseline);
 const ledger=change(revision,'approve','review','reviewer'),c=createSemanticComparison(r,ledger);
 expect(c.adoptedCount).toBe(1);expect(c.baseline.correct).toBe(2);expect(c.candidate.correct).toBe(1);
 expect(c.baseline.total).toBe(8);expect(c.candidate.total).toBe(8);expect(c.roles.map(x=>x.candidate.total)).toEqual([4,4]);
 expect(c.humanReferenceCount).toBe(0);expect(c.qualityClaimEligible).toBe(false);expect(c.inferenceReexecuted).toBe(false);
 expect(JSON.stringify({r,revision})).toBe(before);expect(verifySemanticComparison(c,r,ledger)).toEqual(c);
 expect(JSON.stringify(c)).not.toContain('合成修订');expect(JSON.stringify(c)).not.toContain('reviewer');
},20000);
test('dispute and revision invalidate candidate eligibility; stale and forged artifacts reject',async()=>{
 const r=await predict(),revision=change(createReviewLedger(1000),'revise','edit','author'),approved=change(revision,'approve','review','reviewer');
 const disputed=change(approved,'dispute','dispute','other');expect(createSemanticComparison(r,disputed).adoptedCount).toBe(0);
 const c=createSemanticComparison(r,approved),bad=structuredClone(c);bad.candidate.correct=8;const{digest,...body}=bad;bad.digest=contentHash(body);
 expect(()=>verifySemanticComparison(bad,r,approved)).toThrow('SEMANTIC_COMPARISON_INVALID');
 expect(()=>verifySemanticComparison(c,r,revision)).toThrow('SEMANTIC_COMPARISON_INVALID');
 const stale=structuredClone(approved);stale.datasetDigest='0'.repeat(64);const{digest:old,...b}=stale;stale.digest=contentHash(b);
 expect(()=>createSemanticComparison(r,stale)).toThrow('SEMANTIC_COMPARISON_INVALID');
 const forged=structuredClone(approved);forged.baseline[0]!.roleId='web-frontend';const{digest:old2,...b2}=forged;forged.digest=contentHash(b2);
 expect(()=>createSemanticComparison(r,forged)).toThrow('SEMANTIC_COMPARISON_INVALID');
},20000);
test('all failed and uncertain predictions preserve denominators and null unsupported acceptance',async()=>{
 const ledger=change(change(createReviewLedger(1000),'revise','edit','author'),'approve','review','reviewer');
 for(const judge of [async()=>{throw Error('synthetic');},async()=>({verdict:'uncertain'})]){
  const r=await runSemanticBenchmark({judge}),c=createSemanticComparison(r,ledger);
  expect(c.candidate.total).toBe(8);expect(c.candidate.accuracy).toBe(0);expect(c.candidate.unsupportedAcceptanceRate).toBeNull();
  expect(c.candidate.unsupportedJudgmentCoverage).toBe(0);expect(c.candidate.judgmentCoverage).toBe(0);
 }
},20000);

test('unrevised approval is not candidate; rationale-only revision counts adoption without changing metrics, later revision resets eligibility',async()=>{
 const r=await predict(),base=createReviewLedger(1000),approvedBase=change(base,'approve','base-review','reviewer');
 expect(createSemanticComparison(r,approvedBase).adoptedCount).toBe(0);
 const c=inspectReviewLedger(approvedBase).claims[0]!;
 const edit:SemanticReviewOperation={operationId:'rationale-edit',expectedLedgerVersion:approvedBase.version,claimId:c.claimId,expectedLabelVersion:c.labelVersion,
  requestDigest:c.requestDigest,labelDigest:c.labelDigest,occurredAt:2000,action:{kind:'revise_label',reference:{verdict:c.verdict,rationale:'只修改理由的合成标签'},changeReason:'测试理由变化'}};
 const revised=recordSemanticReview(approvedBase,edit,{actorId:'author',now:2000});
 expect(createSemanticComparison(r,revised).adoptedCount).toBe(0);
 const approved=change(revised,'approve','new-review','reviewer'),comparison=createSemanticComparison(r,approved);
 expect(comparison.adoptedCount).toBe(1);expect(comparison.candidate).toEqual(comparison.baseline);
 const later=change(approved,'revise','later','author');expect(createSemanticComparison(r,later).adoptedCount).toBe(0);
},20000);

test('unstable prediction source is refused even with a consistent report digest',async()=>{
 const r=await predict(),unstable={...r,sourceStable:false,status:'failed' as const};
 const{digest,...body}=unstable;unstable.digest=contentHash(body);
 expect(()=>createSemanticComparison(unstable,createReviewLedger(1000))).toThrow('SEMANTIC_COMPARISON_INVALID');
},20000);
