import {ScoringQualityCaseSchema,ScoringQualityRowSchema,type ScoringQualityCase,type ScoringQualityRow} from '../../packages/contracts/src/scoring-quality.ts';
import {validateBenchmarkAssessment} from '../answers/validation.ts';
import {RubricSchema} from '../../packages/contracts/src/scoring.ts';
import {inspectVerificationBinding} from '../../packages/interview-domain/src/verification-binding.ts';
import type {ScoringQualityBatch} from '../../packages/contracts/src/scoring-quality.ts';
import {ScoringQualityReportSchema} from '../../packages/contracts/src/scoring-quality.ts';
import {canonical} from '../answers/validation.ts';
function invalid():never{throw Error('SCORING_QUALITY_REPORT_INVALID');}
function project(sample:ScoringQualityCase,row:ScoringQualityRow){
 if(row.status!=='completed'){
  if(row.status==='not_run'&&(row.snapshot!==null||row.requestDigest!==null||row.errorCode!==null)||row.snapshot?.status==='completed')invalid();
  return{caseId:sample.id,roleId:sample.roleId,category:sample.category,outcome:row.status,expectedOutcome:sample.expectedOutcome,outcomeMatched:false,bands:[] as {criterionId:string;predicted:number;min:number;max:number;matched:boolean}[],evidenceValid:null,bindingValid:null};
 }
 const snapshot=row.snapshot;if(!snapshot||snapshot.status!=='completed'||row.errorCode!==null||!row.requestDigest)invalid();
 const result=snapshot.result;
 if(result?.kind==='uncommitted-unscored-turn-result'){
  const r=result.resolution;
  if(r.normalizedScore!==null||r.basedOn.questionId!==sample.item.id)invalid();
  return{caseId:sample.id,roleId:sample.roleId,category:sample.category,outcome:r.status,expectedOutcome:sample.expectedOutcome,
   outcomeMatched:r.status===sample.expectedOutcome&&canonical([...r.missingCriterionIds].sort())===canonical(sample.item.rubric.map(c=>c.criterionId).sort())&&r.reason===(sample.category==='abstention'?'clarification_limit':'evidence_insufficient'),bands:[],evidenceValid:null,bindingValid:null};
 }
 if(result?.kind!=='uncommitted-turn-result')invalid();
 const proposal=result.proposal,evaluation=proposal.evaluation;
 if(proposal.basedOn.questionId!==sample.item.id||!evaluation.complete||evaluation.normalizedScore===null||evaluation.missingDimensions.length)invalid();
 const rubric=RubricSchema.parse({id:sample.item.id,version:sample.item.version,roleId:sample.roleId,scope:sample.item.questionType==='behavioral'?'behavioral-content':'technical-content',
  criteria:sample.item.rubric.map(c=>({id:c.criterionId,maxScore:c.maxScore,weight:c.weight,required:true,...(c.verificationGoal?{dimension:c.dimension,verificationGoal:c.verificationGoal}:{})}))});
 const scores=evaluation.dimensions.map(({criterionId,score,evidenceIds,verificationBinding})=>({criterionId,score,evidenceIds,...(verificationBinding?{verificationBinding}:{})}));
 let evidenceValid=true;try{validateBenchmarkAssessment({evidence:proposal.evidence,criterionScores:scores},rubric,sample.answer);}catch{evidenceValid=false;}
 let weighted=0,bindingValid=true;
 for(const criterion of rubric.criteria){const score=scores.find(s=>s.criterionId===criterion.id);if(!score||score.score===null||score.score>criterion.maxScore)invalid();
  weighted+=score.score/criterion.maxScore*criterion.weight;
  const check=inspectVerificationBinding(criterion.verificationGoal,score.verificationBinding,proposal.evidence,score.evidenceIds,sample.answer);
  if(!['bound','not_required'].includes(check.status))bindingValid=false;
 }
 if(Math.abs(weighted-evaluation.normalizedScore)>1e-9)invalid();
 const bands=sample.reference.bands.map(b=>{const c=sample.item.rubric.find(c=>c.criterionId===b.criterionId)!,d=scores.find(d=>d.criterionId===b.criterionId)!;
  const predicted=d.score!/c.maxScore;return{...b,predicted,matched:predicted>=b.min&&predicted<=b.max};});
 return{caseId:sample.id,roleId:sample.roleId,category:sample.category,outcome:'scored',expectedOutcome:sample.expectedOutcome,outcomeMatched:sample.expectedOutcome==='scored',bands,evidenceValid,bindingValid};
}

export function renderScoringQuality(batch:ScoringQualityBatch,raw:unknown){
 const report=ScoringQualityReportSchema.parse(raw),a=report.analysis;
 return ['# 双岗评分质量草案对照','',`范围：${report.scope}；模式：${report.mode}；状态：${report.status}`,'',
  '样例/标签/区间由AI制作，人工参考0；这不是独立语义质量认证。正常/验证题的区间与证据支持度仍需独立审核。结构通过、草案一致和评分准确是不同结论。',
  'null不转0，失败不当作弃评；失败/未运行保留在8例分母中。本文不代表桌面、本地stdio、用户体验或账单验收。',
  '',`运行完成 ${a.protocolCompleted}/8；预期行为一致 ${a.expectedOutcomeMatched}/8；草案区间匹配 ${a.bandAgreement.matched}/${a.bandAgreement.paired}（预期配对 ${a.expectedBandCount}）。`,
  `HTTP ${report.totals.httpAttempts}/6；tokens ${report.totals.usedTokens}；声明估算 ${report.totals.usedCostMicros/1000000} 元；unknown阻断 ${report.stoppedForAccounting}。`,'',
  '| 岗位 | 类型 | 预期 | 实际 | 区间匹配 | 引用/绑定字面检查 |','|---|---|---|---|---|---|',
  ...a.observations.map(r=>`| ${r.roleId} | ${r.category} | ${r.expectedOutcome} | ${r.outcome} | ${r.bands.filter(b=>b.matched).length}/${r.bands.length} | ${r.evidenceValid??'未评分'}/${r.bindingValid??'未评分'} |`),'',
  ...batch.cases.flatMap(c=>{const row=report.rows.find(r=>r.caseId===c.id)!,o=a.observations.find(r=>r.caseId===c.id)!;return[`## ${c.id}`,'',c.item.question,'',c.answer,'',
   `草案参考：${c.reference.rationale}`,`分数投影：${JSON.stringify(o.bands)}`,`错误：${row.errorCode??'无'}；诊断：${row.diagnostics.filter(d=>d.outcome==='rejected').map(d=>d.stage+'/'+d.reason+(d.bindingIssue?'/'+d.bindingIssue:'')).join('；')||'无拒绝诊断'}`,''];}),
  `批次摘要 ${batch.digest}`,`报告摘要 ${report.digest}`].join('\n');
}
/** Draft-reference arithmetic, not independent semantic certification or inference authentication. */
export function analyzeScoringQuality(rawCases:unknown[],rawRows:unknown[]){
 const cases=rawCases.map(c=>ScoringQualityCaseSchema.parse(c)),rows=rawRows.map(r=>ScoringQualityRowSchema.parse(r));
 if(cases.length!==8||rows.length!==cases.length||new Set(cases.map(c=>c.id)).size!==8||new Set(rows.map(r=>r.caseId)).size!==8||rows.some(r=>!cases.some(c=>c.id===r.caseId)))invalid();
 const observations=cases.map(c=>project(c,rows.find(r=>r.caseId===c.id)!));
 const roles=(['java-backend','web-frontend']as const).map(roleId=>{const selected=observations.filter(r=>r.roleId===roleId);if(selected.length!==4||new Set(selected.map(s=>s.category)).size!==4)invalid();
  return{roleId,total:selected.length,outcomeMatched:selected.filter(r=>r.outcomeMatched).length};});
 const bands=observations.flatMap(r=>r.bands),paired=bands.length,matched=bands.filter(b=>b.matched).length;
 const expectedBands=cases.reduce((n,c)=>n+c.reference.bands.length,0),protocolCompleted=rows.filter(r=>r.status==='completed').length;
 const expectedOutcomeMatched=observations.filter(r=>r.outcomeMatched).length;
 const draftChecksPassed=protocolCompleted===8&&expectedOutcomeMatched===8&&paired===expectedBands&&matched===paired&&observations.every(r=>r.evidenceValid!==false&&r.bindingValid!==false);
 return{total:8,protocolCompleted,failed:rows.filter(r=>r.status==='failed').length,unrun:rows.filter(r=>r.status==='not_run').length,expectedOutcomeMatched,
  bandAgreement:{matched,paired,ratio:paired?matched/paired:null},expectedBandCount:expectedBands,roles,observations,draftChecksPassed,
  humanReferenceCount:0 as const,qualityClaimEligible:false as const,semanticReview:'assistant-authored-draft-only' as const};
}
