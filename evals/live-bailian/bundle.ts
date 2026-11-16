import { mkdir,mkdtemp,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digest,type prepareBailianAcceptance,type runBailianAcceptance } from './runner.ts';
export async function prepareAcceptanceBundle(root:string,plan:ReturnType<typeof prepareBailianAcceptance>) {
 const base=join(root,'.cache','live-bailian-acceptance');await mkdir(base,{recursive:true});
 const dir=await mkdtemp(join(base,'run-'));
 await writeFile(join(dir,'plan.json'),JSON.stringify({state:'prepared-not-completed',plan},null,2)+'\n');return dir;
}
export async function writeAcceptanceBundle(dir:string,result:Awaited<ReturnType<typeof runBailianAcceptance>>) {
 await writeFile(join(dir,'report.json'),JSON.stringify({version:1,result,digest:digest(result)},null,2)+'\n');
 await writeFile(join(dir,'review.md'),[
  '# 小样本人工复核',
  '待审核；没有人工参考分，不得将结构成功称为评分准确。',
  '逐岗核对 report.json：题目/量规、回答原文、引用偏移、分维分数与理由、知识工具回执、候选题关联、延迟及账本。',
  '失败时查看 evaluationDiagnostics 的阶段/原因枚举和 plan.outputRepair；repaired仅表示格式处理，不表示后续结构、证据或评分通过。旧报告没有此字段时，具体校验根因仍未知。',
  '恢复配置见 plan.recovery，过程见 recoveryDiagnostics。rejected保留最坏预算，不等于免费；结构修复仍需引用与算分通过，旧报告缺字段不补造恢复记录。',
  '记录独立参考分、分歧与修改建议；不要直接用模型自己的分数充当金标准。',
  '本工具只测试结构化评分和题库选题；自然追问、供应商账单、语音、正式提交均未验证。',
 ].join('\n\n')+'\n');return join(dir,'report.json');
}
