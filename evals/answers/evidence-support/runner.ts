import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { supportCases } from './cases.ts';
import { evidenceSupportRejection } from '../../../packages/interview-domain/src/evidence-support.ts';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
/** Policy conformance only; assistant-authored expectations are not semantic ground truth. */
export function runEvidenceSupportMatrix(){
 const rows=supportCases.map(c=>{
  const actual=evidenceSupportRejection(c.dimension?{dimension:c.dimension}:{},c.quotes,c.quotes.join('\n'));
  return {id:c.id,group:c.group,lane:c.lane,expectedPolicy:c.expected,actualPolicy:actual,
   outcome:c.lane==='known-limit'?'requires-semantic-review' as const:actual===c.expected?'matched' as const:'failed' as const,
   limitation:c.limitation??null};
 });
 const regressions=rows.filter(r=>r.lane==='regression'),failed=regressions.filter(r=>r.outcome==='failed').length;
 return {version:1 as const,origin:'assistant-authored-synthetic-development' as const,
  datasetDigest:digest(JSON.stringify(supportCases)),
  ruleDigest:digest(readFileSync(new URL('../../../packages/interview-domain/src/evidence-support.ts',import.meta.url),'utf8')),
  runnerDigest:digest(readFileSync(new URL('./runner.ts',import.meta.url),'utf8')),
  summary:{regressions:regressions.length,matched:regressions.length-failed,failed,knownLimits:rows.length-regressions.length},
  rows,status:failed?'failed-policy-regressions' as const:'passed-policy-regressions-with-known-limits' as const,
  liveModelCalls:0 as const,humanReferenceCount:0 as const,qualityClaimEligible:false as const,
  semanticSupport:'not_verified' as const,
 };
}
