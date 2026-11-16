import {test,expect} from 'bun:test';
import {loadVerificationProposal,compileVerificationProposal,createVerificationReviewPacket,verifyVerificationReviewPacket} from '../evals/knowledge-verification/index.ts';
import {loadKnowledgeWorkspace} from '../apps/agent/src/knowledge/catalog.ts';
import {contentHash} from '../evals/answers/validation.ts';
import {exportVerificationKnowledgeReview} from '../scripts/verification-knowledge-review.ts';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

test('observation candidates stay isolated, versioned and distinct by role',()=>{
 const at=1794096000000,before=JSON.stringify(loadKnowledgeWorkspace(at)),p=compileVerificationProposal(loadVerificationProposal('observation'));
 expect(p.catalog.summary.reviewed).toBe(0);expect(p.catalog.summary.readyForHumanReview).toBe(2);
 expect(p.workspace.items.map(i=>i.rubric.find(c=>c.verificationGoal)!.verificationGoal!.observationPolicy!.kind)).toEqual(['count','duration']);
 expect(p.workspace.items.every(i=>i.reviewStatus==='draft'&&i.version!==p.baseItems.find(b=>b.id===i.id)!.version)).toBe(true);
 expect(JSON.stringify(loadKnowledgeWorkspace(at))).toBe(before);
});

test('packet preserves frozen risk labels and records the new local rejection without claiming semantic quality',()=>{
 const r=createVerificationReviewPacket('observation');
 expect(r.calibration.summary).toEqual({total:18,regressions:16,regressionsMatched:16,knownRisks:2});
 expect(r.calibration.rows.filter(c=>c.id.endsWith('missing-detail')).every(c=>c.reason==='verification-observation-detail-missing')).toBe(true);
 expect(r.calibration.rows.filter(c=>c.lane==='known-risk').every(c=>!c.actualBound&&!c.expectedBound&&c.reason==='verification-observation-context-mismatch')).toBe(true);
 expect(r.humanReferenceCount).toBe(0);expect(r.qualityClaimEligible).toBe(false);expect(r.productionPublished).toBe(false);
 expect(verifyVerificationReviewPacket(r).digest).toBe(r.digest);
});

test('recomputed hash cannot hide fabricated typed calibration or an invented observation excerpt',()=>{
 const original=createVerificationReviewPacket('observation');
 const r=structuredClone(original);r.calibration.summary.knownRisks=0;const {digest,...body}=r;r.digest=contentHash(body);
 expect(()=>verifyVerificationReviewPacket(r)).toThrow('VERIFICATION_REVIEW_INVALID');
 const raw=loadVerificationProposal('observation');raw.cases[0]!.observation!.value='unquoted-value';
 expect(()=>compileVerificationProposal(raw)).toThrow('VERIFICATION_REVIEW_INVALID');
});

test('exported observation review shows policy, risks and blank human checks under one packet identity',async()=>{
 const r=await exportVerificationKnowledgeReview('observation');
 const packet=verifyVerificationReviewPacket(JSON.parse(await readFile(join(r.output,'packet.json'),'utf8')));
 const template=JSON.parse(await readFile(join(r.output,'review-template.json'),'utf8'));
 const markdown=await readFile(join(r.output,'review.md'),'utf8');
 expect(template.packetDigest).toBe(packet.digest);expect(template.rows.every((x:any)=>x.reviewerId===null&&x.decision===null&&x.checks.observationConditions===null)).toBe(true);
 expect(markdown.includes('actualDuration')).toBe(true);expect(markdown.includes('初值99')).toBe(true);
 expect(markdown.includes('16条规则回归')).toBe(true);expect(markdown.includes('已知风险')).toBe(true);
});
