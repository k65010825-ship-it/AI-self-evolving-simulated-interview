import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {inspectVerificationBinding} from '../../packages/interview-domain/src/verification-binding.ts';
import {contentHash} from '../answers/validation.ts';
import type {CompiledProposal} from './proposal.ts';
export function runAliasCalibration(p:CompiledProposal){
 const rows=p.cases.map(c=>{
  const goal=p.workspace.items.find(i=>i.id===c.itemId)!.rubric.find(r=>r.verificationGoal)!.verificationGoal!;
  const ref=(fragment:string)=>({evidenceId:'unit',start:c.text.indexOf(fragment),end:c.text.indexOf(fragment)+fragment.length});
  const result=inspectVerificationBinding(goal,{goalId:goal.id,goalVersion:goal.version,mode:c.mode,action:ref(c.action),target:ref(c.target),expectation:ref(c.expectation),
   ...(c.observation?{observation:{metric:ref(c.observation.metric),value:ref(c.observation.value),condition:ref(c.observation.condition)}}:{})},
   [{id:'unit',start:0,end:c.text.length,excerpt:c.text}],['unit'],c.text);
  const actualBound=result.status==='bound';
  return {id:c.id,itemId:c.itemId,roleId:c.roleId,lane:c.lane,expectedBound:c.expectedBound,actualBound,status:result.status,
   reason:'reason'in result?result.reason:null,matched:c.expectedBound===actualBound,note:c.note};
 });
 const ratio=(count:number,denominator:number)=>({count,denominator,rate:denominator?count/denominator:null});
 const byRole=(['java-backend','web-frontend'] as const).map(roleId=>{
  const cases=rows.filter(r=>r.roleId===roleId),positive=cases.filter(r=>r.expectedBound),negative=cases.filter(r=>!r.expectedBound);
  return {roleId,total:cases.length,draftFalseAcceptance:ratio(negative.filter(r=>r.actualBound).length,negative.length),
   draftFalseRejection:ratio(positive.filter(r=>!r.actualBound).length,positive.length)};
 });
 const regressions=rows.filter(r=>r.lane==='regression'),matched=regressions.filter(r=>r.matched).length;
 return {version:1,origin:'assistant-authored-synthetic-development' as const,
  // Bind the delegated value checker too: parent-file hashes alone miss dependency changes.
  ruleDigest:contentHash(['verification-binding.ts','observation-value.ts'].map(path=>({path,
   sha256:createHash('sha256').update(readFileSync(new URL('../../packages/interview-domain/src/'+path,import.meta.url))).digest('hex')}))),
  runnerDigest:createHash('sha256').update(readFileSync(new URL('./calibration.ts',import.meta.url))).digest('hex'),
  datasetDigest:contentHash(p.cases),goalsDigest:contentHash(p.workspace.items.map(i=>({itemId:i.id,version:i.version,goals:i.rubric.filter(c=>c.verificationGoal).map(c=>c.verificationGoal)}))),
  summary:{total:rows.length,regressions:regressions.length,regressionsMatched:matched,knownRisks:rows.length-regressions.length},byRole,rows,
  status:matched===regressions.length?'passed-regressions-with-draft-risks' as const:'failed-regressions' as const,
  semanticSupport:'not_verified' as const,humanReferenceCount:0 as const,qualityClaimEligible:false as const,liveModelCalls:0 as const};
}
