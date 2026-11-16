import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createVerificationReviewPacket,verifyVerificationReviewPacket} from '../evals/knowledge-verification/index.ts';
import type {ProposalVariant} from '../evals/knowledge-verification/proposal.ts';
export async function exportVerificationKnowledgeReview(variant:ProposalVariant='baseline'){
 const packet=createVerificationReviewPacket(variant),root=join(process.cwd(),'.cache','verification-knowledge-review');await mkdir(root,{recursive:true});
 const output=await mkdtemp(join(root,'run-'));
 await writeFile(join(output,'packet.json'),JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
 await writeFile(join(output,'alias-calibration.json'),JSON.stringify({packetDigest:packet.digest,calibration:packet.calibration},null,2)+'\n',{flag:'wx'});
 await writeFile(join(output,'review-template.json'),JSON.stringify({packetDigest:packet.digest,rows:packet.reviewTemplate},null,2)+'\n',{flag:'wx'});
 const lines=['# 双岗位验证目标知识审核提案','','状态：AI编写草案；未批准、未发布、未加载到当前24题。所有别名案例为合成开发样本，没有独立人工参考。',
  '',`提案摘要：${packet.digest}`,'','packet.json包含原题/候选/差异、来源核对、案例和评测；review-template.json保持空白，填写模板也不等于已执行正式批准。',
  '','## 别名风险','', '“误放行/误弃评”对照AI草案的“是否可进入结构评分”标签，并非答案正确性标签。有关但技术错误的过程可以进入评分并得0。',
  '','| 岗位 | 潜在误放行/负例 | 潜在误弃评/正例 |','|---|---|---|',
  ...packet.calibration.byRole.map(r=>`| ${r.roleId} | ${r.draftFalseAcceptance.count}/${r.draftFalseAcceptance.denominator} | ${r.draftFalseRejection.count}/${r.draftFalseRejection.denominator} |`),
  '', `${packet.calibration.summary.regressions}条规则回归和${packet.calibration.summary.knownRisks}条已知风险分开统计；不能把未命中规则当语义支持。`,
  'known-risk分组与案例原始说明冻结，说明描述编制时的风险；当前是否被拒绝以actualBound/静态原因为准，不改标签来制造提升。已知风险可能仍被规则放行，审核包不会把它们计入回归通过。观测摘录为AI注入，不是模型抽取质量或真实学生证据。来源核对记录沿用原提案，不是本轮重新获取或专家批准。','','## 审核检查','',
  '- 操作、对象和指标是否与问题前提一致；别名是否过宽/过窄。','- 0分锚点是否仍要求有关错误依据，缺证据是否保持null。','- 结构绑定是否被错误当成验证充分、真实执行或学习效果。','- 新题版本、来源章节、适用范围与其他维度权重是否一致。','- 评测只验证规则；修改别名后须重新冻结案例与提案摘要。'];
 for(const entry of packet.entries){const goal=entry.candidate.rubric.find(c=>c.verificationGoal)!.verificationGoal!;
  lines.push('',`## ${entry.candidate.roleId}：${entry.candidate.id}`,'',`版本：${entry.base.version} → ${entry.candidate.version}；审核状态：${entry.reviewStatus}。`,
   '',entry.candidate.question,'',`操作别名：${goal.actionAliases.join('；')}`,`目标别名：${goal.targetAliases.join('；')}`,`指标别名：${goal.observationAliases.join('；')}`,
   '',`适用：${entry.dossier.applicability}`,'',entry.dossier.answerGuide,'','验证维度锚点：',
   ...entry.candidate.rubric.find(c=>c.verificationGoal)!.anchors!.map(a=>`- ${a.score}：${a.description}`),'','参考：',...entry.sources.filter(s=>s.url).map(s=>`- [${s.title}](${s.url})；${s.version}`));
  if(goal.observationPolicy)lines.push('',`观测类型：${goal.observationPolicy.kind}；条件：${goal.observationPolicy.conditionAliases.join('；')}`,
   `精确谓词：${goal.observationPolicy.predicateAliases?.join('；')??'无'}`,
   'metric/value须位于expectation内，condition在同一证据单元；条件出现不等于它确实约束了该结果。缺提取保持未知，相关错误仍可评0。');
 }
 lines.push('','## 全部开发样例','','| ID | 分组 | 草案预期可绑定 | 实际可绑定 | 原答片段 |','|---|---|---|---|---|',
  ...packet.calibration.rows.map(r=>{const c=packet.proposal.cases.find(c=>c.id===r.id)!;return `| ${r.id} | ${r.lane} | ${r.expectedBound} | ${r.actualBound} | ${c.text.replaceAll('|','\\|')} |`;}),'');
 for(const c of packet.proposal.cases){const result=packet.calibration.rows.find(r=>r.id===c.id)!;lines.push(`- ${c.id}：当前结构结果=${result.status}/${result.reason??'none'}；冻结说明：${c.note}${c.observation?'；注入观测='+JSON.stringify(c.observation):'；无观测细节'}`);}
 await writeFile(join(output,'review.md'),lines.join('\n'),{flag:'wx'});
 verifyVerificationReviewPacket(JSON.parse(await readFile(join(output,'packet.json'),'utf8')));
 return {output,digest:packet.digest,candidates:packet.entries.length,calibration:packet.calibration.summary,reviewed:0,productionPublished:false,humanReferenceCount:0,qualityClaimEligible:false,liveModelCalls:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const args=process.argv.slice(2);if(args.length>1||args.length===1&&args[0]!=='--observation')throw Error('usage');
  console.log(JSON.stringify(await exportVerificationKnowledgeReview(args[0]==='--observation'?'observation':'baseline')));}
 catch{console.error('VERIFICATION_REVIEW_EXPORT_FAILED');process.exitCode=1;}
}
