import {inspectScoringQuality} from './runner.ts';
import {canonical,contentHash} from '../answers/validation.ts';
import {ScoringStabilityComparisonSchema} from '../../packages/contracts/src/scoring-stability.ts';
/** Read/recompute only. No credentials, new model runs, repairs or label changes. */
export async function compareScoringQuality(left:string,right:string){
 const results=await Promise.allSettled([inspectScoringQuality(left),inspectScoringQuality(right)]);
 if(results[0].status!=='fulfilled'||results[1].status!=='fulfilled')throw Error('SCORING_STABILITY_REPORT_INVALID');
 const [a,b]=[results[0].value,results[1].value],policy=a.batch.stabilityPolicy;
 if(a.batch.digest===b.batch.digest||a.report.digest===b.report.digest||a.batch.suite!=='challenge'||b.batch.suite!=='challenge'||!policy||
  a.report.mode!==b.report.mode||canonical(policy)!==canonical(b.batch.stabilityPolicy)||
  canonical([a.batch.cases,a.batch.config,a.batch.sourceManifest])!==canonical([b.batch.cases,b.batch.config,b.batch.sourceManifest]))throw Error('SCORING_STABILITY_INPUT_MISMATCH');
 const outcomes=a.report.analysis.observations.map(x=>{const y=b.report.analysis.observations.find(o=>o.caseId===x.caseId)!;
  return{caseId:x.caseId,left:x.outcome,right:y.outcome,consistent:!['failed','not_run'].includes(x.outcome)&&x.outcome===y.outcome};});
 const dimensions=a.batch.cases.flatMap(c=>c.reference.bands.flatMap(band=>{
  const x=a.report.analysis.observations.find(o=>o.caseId===c.id)!.bands.find(d=>d.criterionId===band.criterionId),y=b.report.analysis.observations.find(o=>o.caseId===c.id)!.bands.find(d=>d.criterionId===band.criterionId);
  return x&&y?[{caseId:c.id,criterionId:band.criterionId,left:x.predicted,right:y.predicted,absoluteDrift:Math.abs(x.predicted-y.predicted)}]:[];
 }));
 const expectedDimensionPairs=a.batch.cases.reduce((n,c)=>n+c.reference.bands.length,0),pairedDimensions=dimensions.length,outcomeConsistent=outcomes.filter(o=>o.consistent).length;
 const meanAbsoluteDrift=pairedDimensions?dimensions.reduce((n,d)=>n+d.absoluteDrift,0)/pairedDimensions:null,maxAbsoluteDrift=pairedDimensions?Math.max(...dimensions.map(d=>d.absoluteDrift)):null;
 const bothDraftChecksPassed=a.report.status==='passed-draft-checks'&&b.report.status==='passed-draft-checks';
 const body={version:1 as const,mode:a.report.mode,batchDigests:[a.batch.digest,b.batch.digest],reportDigests:[a.report.digest,b.report.digest],policy,total:8 as const,
  outcomeConsistent,expectedDimensionPairs,pairedDimensions,missingDimensionPairs:expectedDimensionPairs-pairedDimensions,bothDraftChecksPassed,meanAbsoluteDrift,maxAbsoluteDrift,
  draftStabilityPassed:bothDraftChecksPassed&&outcomeConsistent===8&&pairedDimensions===expectedDimensionPairs&&maxAbsoluteDrift!==null&&maxAbsoluteDrift<=policy.maxNormalizedDrift,
  outcomes,dimensions,humanReferenceCount:0 as const,qualityClaimEligible:false as const};
 return ScoringStabilityComparisonSchema.parse({...body,digest:contentHash(body)});
}
