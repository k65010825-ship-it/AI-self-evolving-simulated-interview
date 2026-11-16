import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createAliasRevisionComparison,verifyAliasRevisionComparison} from '../evals/knowledge-verification/revision.ts';
export async function exportAliasRevisionComparison(){
 const c=createAliasRevisionComparison(),root=join(process.cwd(),'.cache','verification-alias-comparison');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'run-'));
 await writeFile(join(output,'comparison.json'),JSON.stringify(c,null,2)+'\n',{flag:'wx'});
 const template={comparisonDigest:c.digest,reviewerId:null,decision:null,notes:null,items:c.candidate.workspace.items.map(i=>({itemId:i.id,itemVersion:i.version,goalVersion:i.rubric.find(r=>r.verificationGoal)!.verificationGoal!.version,checks:{aliases:null,newFalseAcceptances:null,labelCaveats:null}}))};
 await writeFile(join(output,'candidate-review-template.json'),JSON.stringify(template,null,2)+'\n',{flag:'wx'});
 const lines=['# 同义别名修订：冻结对照','','结论：'+c.recommendation+'；未采纳、未发布。全部标签来自AI合成开发数据，不是独立保留集或真人效果。',
  '',`摘要：${c.digest}`,'','只追加字面别名并升级候选/goal/dossier版本；原24样例和标签不变，补充6条配对开发反例。',
  '',`修复潜在误弃评：${c.summary.resolvedDraftFalseRejections}；新增潜在误放行：${c.summary.introducedDraftFalseAcceptances}；原20条规则回归保持：${c.summary.frozenRegressionsPreserved}。`,
  '','## 相同30条开发数据的前后计数','','| 岗位 | 误放行：前→后（负例分母） | 误弃评：前→后（正例分母） |','|---|---|---|',
  ...c.baselineCalibration.byRole.map(b=>{const a=c.candidateCalibration.byRole.find(a=>a.roleId===b.roleId)!;return `| ${b.roleId} | ${b.draftFalseAcceptance.count}→${a.draftFalseAcceptance.count} / ${a.draftFalseAcceptance.denominator} | ${b.draftFalseRejection.count}→${a.draftFalseRejection.count} / ${a.draftFalseRejection.denominator} |`;}),
  '','计数表示是否可进入结构评分，不表示答案正确；相关错误过程仍可能评0。新增负例误放行即不建议采纳，不能只按正例覆盖率选择候选。',
  '','## 别名增量','','| 条目 | 分组 | 新增 |','|---|---|---|',...c.revisions.map(r=>`| ${r.itemId} | ${r.group} | ${r.added.join('；')} |`),
  '','## 标签待复核','',...c.labelCaveats.map(x=>`- ${x.caseId}：${x.reason}`),
  '','## 每例对照','','| ID | 来源 | 草案预期 | 基线 | 修订 |','|---|---|---|---|---|',...c.rows.map(r=>`| ${r.caseId} | ${r.source} | ${r.expectedBound} | ${r.before} | ${r.after} |`),
  '','完整快照、来源、案例、规则/runner摘要与重新计算结果见comparison.json。哈希只验证一致性，不认证作者或审核者。补充例子同样由开发者编写，不能称独立外部测试。',''];
 await writeFile(join(output,'comparison.md'),lines.join('\n'),{flag:'wx'});
 verifyAliasRevisionComparison(JSON.parse(await readFile(join(output,'comparison.json'),'utf8')));
 return {output,digest:c.digest,summary:c.summary,recommendation:c.recommendation,adopted:false,productionPublished:false,humanReferenceCount:0,qualityClaimEligible:false,liveModelCalls:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==2)throw Error('usage');console.log(JSON.stringify(await exportAliasRevisionComparison()));}catch{console.error('ALIAS_REVISION_EXPORT_FAILED');process.exitCode=1;}}
