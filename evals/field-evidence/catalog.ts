import { loadKnowledgeWorkspace } from '../../apps/agent/src/knowledge/catalog.ts';
import { buildKnowledgeCatalog } from '../../apps/agent/src/knowledge/curation.ts';
import { createReviewBundle, evaluateCohort } from './index.ts';
/** Read-only export of current source, not generated content or approval. */
export function createCatalogReviewBundle(now=Date.now()){
 const workspace=loadKnowledgeWorkspace(now),catalog=buildKnowledgeCatalog(workspace,{mode:'draft-preview'});
 return createReviewBundle({datasetId:'current-two-role-knowledge-review',developmentGroupIds:[],developmentReviewerIds:['assistant-proposed'],minimumCases:8,items:workspace.items.map(item=>{
  const dossier=workspace.dossiers.find(d=>d.itemId===item.id)!;
  const sources=workspace.sources.filter(s=>item.sourceIds.includes(s.id));
  const gate=catalog.entries.find(e=>e.itemId===item.id)!;
  return{id:item.id,version:item.version,roleId:item.roleId,kind:'knowledge',authorId:'assistant-proposed',sourceGroupId:item.sourceIds.slice().sort().join('+'),sourceReferences:dossier.sourceReferences,payload:{authoringStatus:item.reviewStatus,item,dossier,sources,currentReadiness:{ready:gate.ready,issues:gate.issues},catalogContentDigest:gate.contentDigest,catalogSourcesDigest:gate.sourcesDigest},modelScore:null};
 })});
}
/** Safe initial host/UI status. Empty collections remain actionable and not_ready. */
export function fieldEvidenceReadiness(now=Date.now()){
 const b=createCatalogReviewBundle(now);
 const cohort=evaluateCohort({studyId:'pending-real-cohort',baselinePolicyVersion:'baseline-unpublished-v1',candidatePolicyVersion:'candidate-unpublished-v1',developmentGroupIds:[],minimumPairsPerArm:8,pairs:[]});
 return {kind:'field-evidence-readiness',status:'not_ready' as const,authority:'file-declared-unverified' as const,qualityClaimEligible:false,knowledge:{totalTasks:b.privateManifest.tasks.length,pendingTasks:b.privateManifest.tasks.length,importedReviews:0,productionPublished:false},cohort,actions:[
  {id:'knowledge-review',status:'required',description:'Export current knowledge packet; obtain independent source/version reviews; import proposals and explicitly adopt through catalog review.',command:'bun run scripts/field-evidence.ts catalog <new-directory>'},
  {id:'behavior-review',status:'required',description:'Collect held-out original answer, continuation and expression evidence; redact identifiers; obtain two independent labels per task.',command:'bun run scripts/field-evidence.ts export <input.json> <new-directory>'},
  {id:'consented-cohort',status:'required',description:'Enroll distinct consented students in baseline/candidate arms, record independent before/after reviews and verified learning; import without fabricating outcomes.',command:'bun run scripts/field-evidence.ts cohort <cohort.json> <new-report.json>'},
  {id:'identity-verification',status:'external',description:'Verify reviewer identity, independent roles, consent and artifact authenticity in the authorized host; JSON files cannot establish these.'},
 ]};
}
