import {test,expect} from 'bun:test';
import {createAliasRevisionComparison,verifyAliasRevisionComparison} from '../evals/knowledge-verification/revision.ts';
import {loadKnowledgeWorkspace} from '../apps/agent/src/knowledge/catalog.ts';
import {contentHash} from '../evals/answers/validation.ts';
test('frozen cases remain unchanged and both arms use one shared development dataset and rule',()=>{
 const r=createAliasRevisionComparison();
 expect(r.baselineCalibration.datasetDigest).toBe(r.candidateCalibration.datasetDigest);
 expect(r.baselineCalibration.ruleDigest).toBe(r.candidateCalibration.ruleDigest);
 expect(r.summary.frozenCases).toBe(24);expect(r.summary.supplementalCases).toBe(6);
 expect(r.summary.frozenRegressionsPreserved).toBe(true);
 expect(r.labelCaveats.some(c=>c.caseId==='web-project-rendering-risk-1')).toBe(true);
 expect(r.revisions.every(c=>c.added.length>0)).toBe(true);
});
test('improved coverage cannot hide new false acceptance or trigger production publication',()=>{
 const r=createAliasRevisionComparison();
 expect(r.summary.resolvedDraftFalseRejections).toBe(2);expect(r.summary.introducedDraftFalseAcceptances).toBe(2);
 expect(r.recommendation).toBe('changes-required');expect(r.productionPublished).toBe(false);expect(r.qualityClaimEligible).toBe(false);
 expect(loadKnowledgeWorkspace().items).toHaveLength(29);
});
test('recomputed hash cannot hide modified comparison decisions or mutated frozen labels',()=>{
 const original=createAliasRevisionComparison();expect(verifyAliasRevisionComparison(original).digest).toBe(original.digest);
 for(const mutate of [(x:typeof original)=>{x.summary.introducedDraftFalseAcceptances=0;},(x:typeof original)=>{x.baseline.cases[0]!.expectedBound=!x.baseline.cases[0]!.expectedBound;}]){
  const r=structuredClone(original);mutate(r);const {digest,...body}=r;r.digest=contentHash(body);
  expect(()=>verifyAliasRevisionComparison(r)).toThrow('ALIAS_REVISION_INVALID');
 }
});

import {validateAliasRevisionScope} from '../evals/knowledge-verification/revision.ts';
import {compileVerificationProposal,loadVerificationProposal} from '../evals/knowledge-verification/proposal.ts';
test('revision scope rejects unchanged item versions, removed aliases and unrelated question edits',()=>{
 const before=compileVerificationProposal(loadVerificationProposal()),after=compileVerificationProposal(loadVerificationProposal('alias-revision'));
 for(const mutate of [(p:typeof after)=>{p.workspace.items[0]!.version=before.workspace.items[0]!.version;},
  (p:typeof after)=>{p.workspace.items[0]!.question+='unrelated edit';},
  (p:typeof after)=>{p.workspace.items[0]!.rubric.find(c=>c.verificationGoal)!.verificationGoal!.actionAliases.shift();}]){
  const copy=structuredClone(after);mutate(copy);expect(()=>validateAliasRevisionScope(before,copy)).toThrow('ALIAS_REVISION_INVALID');
 }
});

import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {exportAliasRevisionComparison} from '../scripts/verification-alias-comparison.ts';
test('handoff serializes the blocked recommendation and blank review template with one identity',async()=>{
 const r=await exportAliasRevisionComparison();
 const comparison=verifyAliasRevisionComparison(JSON.parse(await readFile(join(r.output,'comparison.json'),'utf8')));
 const template=JSON.parse(await readFile(join(r.output,'candidate-review-template.json'),'utf8'));
 expect(template.comparisonDigest).toBe(comparison.digest);expect(template.reviewerId).toBeNull();expect(template.decision).toBeNull();
 expect(r.adopted).toBe(false);expect(r.recommendation).toBe('changes-required');
 expect((await readFile(join(r.output,'comparison.md'),'utf8')).includes('新增潜在误放行：2')).toBe(true);
});
