import {test,expect} from 'bun:test';
import {loadVerificationProposal,compileVerificationProposal,runAliasCalibration,createVerificationReviewPacket,verifyVerificationReviewPacket} from '../evals/knowledge-verification/index.ts';
import {loadKnowledgeWorkspace} from '../apps/agent/src/knowledge/catalog.ts';
test('candidate versions are draft-only, isolated from the 24 existing questions and human approvals',()=>{
 const before=JSON.stringify(loadKnowledgeWorkspace(1794096000000)),p=compileVerificationProposal(loadVerificationProposal());
 expect(p.workspace.items).toHaveLength(2);expect(p.catalog.summary.reviewed).toBe(0);expect(p.catalog.summary.readyForHumanReview).toBe(2);
 expect(new Set(p.workspace.items.map(i=>i.roleId)).size).toBe(2);
 for(const i of p.workspace.items){expect(i.reviewStatus).toBe('draft');expect(i.version).not.toBe(p.baseItems.find(b=>b.id===i.id)!.version);}
 expect(JSON.stringify(loadKnowledgeWorkspace(1794096000000))).toBe(before);
});
test('alias calibration exposes positive and negative risk cases rather than declaring semantic quality',()=>{
 const r=runAliasCalibration(compileVerificationProposal(loadVerificationProposal()));
 expect(r.summary).toEqual({total:24,regressions:20,regressionsMatched:20,knownRisks:4});
 expect(r.byRole).toHaveLength(2);
 for(const role of r.byRole){expect(role.draftFalseAcceptance.count).toBeGreaterThan(0);expect(role.draftFalseRejection.count).toBeGreaterThan(0);}
 expect(r.qualityClaimEligible).toBe(false);expect(r.humanReferenceCount).toBe(0);expect(r.liveModelCalls).toBe(0);
});
test('review packet binds original, candidate, cases and source evidence; review templates remain blank',()=>{
 const p=createVerificationReviewPacket();expect(verifyVerificationReviewPacket(p).digest).toBe(p.digest);
 expect(p.productionPublished).toBe(false);expect(p.reviewTemplate.every(row=>row.reviewerId===null&&row.decision===null)).toBe(true);
 for(const mutate of [(x:typeof p)=>{x.entries[0]!.candidate.question+='changed';},(x:typeof p)=>{x.calibration.summary.regressionsMatched++;}]){
  const copy=structuredClone(p);mutate(copy);expect(()=>verifyVerificationReviewPacket(copy)).toThrow('VERIFICATION_REVIEW_INVALID');
 }
});

import {contentHash} from '../evals/answers/validation.ts';
test('a recomputed packet hash cannot hide a fabricated calibration summary',()=>{
 const p=createVerificationReviewPacket();p.calibration.summary.regressionsMatched--;
 const {digest,...body}=p;p.digest=contentHash(body);
 expect(()=>verifyVerificationReviewPacket(p)).toThrow('VERIFICATION_REVIEW_INVALID');
});
test('stale bases, same-version candidates, source drift and unbound cases cannot compile',()=>{
 const original=loadVerificationProposal();
 for(const mutate of [
  (p:typeof original)=>{p.manifest.baseItems[0]!.digest='0'.repeat(64);},
  (p:typeof original)=>{p.workspace.items[0]!.version=p.manifest.baseItems[0]!.version;},
  (p:typeof original)=>{p.manifest.sourceChecks[0]!.sourceVersion='stale';},
  (p:typeof original)=>{p.cases[0]!.itemId='unknown';},
  (p:typeof original)=>{p.workspace.reviews=[{decision:'approved'}];},
 ]){const copy=structuredClone(original);mutate(copy);expect(()=>compileVerificationProposal(copy)).toThrow('VERIFICATION_REVIEW_INVALID');}
});

import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {exportVerificationKnowledgeReview} from '../scripts/verification-knowledge-review.ts';
test('exported handoff files share one packet identity and contain no preapproved reviewer',async()=>{
 const r=await exportVerificationKnowledgeReview();
 const packet=verifyVerificationReviewPacket(JSON.parse(await readFile(join(r.output,'packet.json'),'utf8')));
 const report=JSON.parse(await readFile(join(r.output,'alias-calibration.json'),'utf8'));
 const template=JSON.parse(await readFile(join(r.output,'review-template.json'),'utf8'));
 expect(report.packetDigest).toBe(packet.digest);expect(template.packetDigest).toBe(packet.digest);
 expect(report.calibration.ruleDigest).toMatch(/^[a-f0-9]{64}$/);
 expect(template.rows).toEqual(packet.reviewTemplate);expect(r.reviewed).toBe(0);
 expect((await readFile(join(r.output,'review.md'),'utf8')).includes('未批准')).toBe(true);
});
