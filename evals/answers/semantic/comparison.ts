import { SemanticReviewLedgerSchema } from '../../../packages/contracts/src/semantic-review.ts';
import { SemanticComparisonSchema,type SemanticComparison } from '../../../packages/contracts/src/semantic-comparison.ts';
import { compileSemanticDataset,loadSemanticDataset } from './dataset.ts';
import { verifySemanticReport,analyzeSemantic } from './report.ts';
import { inspectReviewLedger } from './reviews.ts';
import { canonical,contentHash } from '../validation.ts';

function invalid():never{throw Error('SEMANTIC_COMPARISON_INVALID');}
export function createSemanticComparison(rawReport:unknown,rawLedger:unknown):SemanticComparison{
 try{
  const report=verifySemanticReport(rawReport),view=inspectReviewLedger(rawLedger),ledger=SemanticReviewLedgerSchema.parse(rawLedger);
  if(!report.sourceStable||view.binding!=='current')invalid();
  const dataset=compileSemanticDataset(loadSemanticDataset());
  const latest=new Map(ledger.baseline.map(b=>[b.claimId,b.reference.verdict]));
  for(const r of ledger.records)if(r.operation.action.kind==='revise_label')latest.set(r.operation.claimId,r.operation.action.reference.verdict);
  const candidates=structuredClone(dataset.samples);
  const claims=dataset.samples.map((s,i)=>{
   const c=view.claims.find(c=>c.claimId===s.id);if(!c)invalid();
   const disposition=c.labelVersion===0?'baseline_unrevised':c.status==='declared_approved'?'adopted':c.status==='disputed'?'baseline_disputed':c.status==='changes_requested'?'baseline_changes_requested':'baseline_unreviewed';
   const verdict=disposition==='adopted'?latest.get(s.id)!:s.reference.verdict;
   candidates[i]!.reference.verdict=verdict;
   return{claimId:s.id,labelVersion:c.labelVersion,labelDigest:c.labelDigest,baselineVerdict:s.reference.verdict,candidateVerdict:verdict,disposition};
  });
  const adoptedCount=claims.filter(c=>c.disposition==='adopted').length;
  const body={version:1,kind:'semantic-candidate-shadow-comparison',datasetDigest:dataset.digest,predictionReportDigest:report.digest,ledgerDigest:ledger.digest,ledgerVersion:ledger.version,
   authority:'file-declared-unverified',selection:'revised-and-declared-approved-only',adoptedCount,unchangedCount:claims.length-adoptedCount,
   baseline:analyzeSemantic(dataset.samples,report.rows),candidate:analyzeSemantic(candidates,report.rows),
   roles:(['java-backend','web-frontend']as const).map(roleId=>({roleId,baseline:analyzeSemantic(dataset.samples.filter(s=>s.roleId===roleId),report.rows),candidate:analyzeSemantic(candidates.filter(s=>s.roleId===roleId),report.rows)})),
   claims,humanReferenceCount:0,qualityClaimEligible:false,baselineOverwritten:false,inferenceReexecuted:false};
  return SemanticComparisonSchema.parse({...body,digest:contentHash(body)});
 }catch{invalid();}
}
export function verifySemanticComparison(raw:unknown,report:unknown,ledger:unknown):SemanticComparison{
 const parsed=SemanticComparisonSchema.safeParse(raw);if(!parsed.success)invalid();
 const expected=createSemanticComparison(report,ledger);if(canonical(parsed.data)!==canonical(expected))invalid();return expected;
}
export function renderSemanticComparison(raw:SemanticComparison){
 const c=SemanticComparisonSchema.parse(raw);
 return ['# 复核候选标签：固定预测隔离对照','',
  `采用候选修订 ${c.adoptedCount}/${c.claims.length}；其余保留原草案。只采用修订后当前版本的本地approved声明。`,
  '指标变化来自参考标签变化，不是模型或教学效果提升。身份file-declared-unverified，人工参考0，qualityClaimEligible=false；不覆盖原参考，不重跑推理。','',
  '| 范围 | 原草案一致率 | 候选一致率 | 原错误支持率 | 候选错误支持率 | 原负例覆盖 | 候选负例覆盖 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...[{roleId:'all',baseline:c.baseline,candidate:c.candidate},...c.roles].map(r=>`| ${r.roleId} | ${r.baseline.accuracy} | ${r.candidate.accuracy} | ${r.baseline.unsupportedAcceptanceRate} | ${r.candidate.unsupportedAcceptanceRate} | ${r.baseline.unsupportedJudgmentCoverage} | ${r.candidate.unsupportedJudgmentCoverage} |`),
  '', '全量预测保留，包括失败/弃权；负例分母可能随标签变化。无有效判断时错误支持率null。摘要只用于一致性，不证明身份或语义。',
  '',`摘要：${c.digest}`,''].join('\n');
}
