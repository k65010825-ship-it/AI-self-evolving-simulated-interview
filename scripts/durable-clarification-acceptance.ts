import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runDurableClarificationAcceptance} from '../experiments/durable-clarification/acceptance.ts';
import {collectDeliverySources} from '../evals/delivery/sources.ts';
import {contentHash} from '../evals/answers/validation.ts';
export async function exportDurableClarificationAcceptance(){
 const before=await collectDeliverySources(process.cwd()),rows=[];
 for(const role of ['java-backend','web-frontend']as const)rows.push(await runDurableClarificationAcceptance(role));
 const sourceManifest=await collectDeliverySources(process.cwd());if(contentHash(before)!==contentHash(sourceManifest))throw Error('DURABLE_CLARIFICATION_SOURCE_CHANGED');
 const checks=rows.map(r=>({role:r.role,passed:r.childExitCode===0&&r.childHttpAttempts===1&&r.childCredentialReads===1&&r.template==='observation-v1'
  &&r.exactResultReplay&&r.exactEventReplay&&r.exactBudgetReplay&&r.replayCredentialReads===0&&r.replayHttpAttempts===0
  &&r.continuationStatus==='completed'&&r.observations===1&&r.normalizedScore===.75&&r.continuationHttpAttempts===1&&r.duplicateContinuationReplay
  &&r.rewriteStatus==='failed'&&r.rewriteError==='VERSION_CONFLICT'&&r.changedRequestRejected&&r.totalSettledTokens===260&&r.budgetRows===2&&r.originalBudgetUnchanged&&r.authorizationRunsUsed===3}));
 const body={version:1,origin:'synthetic-injected-transport',sourceManifest,rows,checks,status:checks.every(c=>c.passed)?'passed-offline-mechanism-checks':'failed',liveModelCalls:0,formalCommitted:false,qualityClaimEligible:false};
 const report={...body,digest:contentHash(body)},root=join(process.cwd(),'.cache','durable-clarification-acceptance');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'run-'));
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 const lines=['# 定向澄清跨进程持久恢复验收','',`摘要：${report.digest}`,'',
  '真实子进程完成澄清后直接退出，真实SQLite重开；使用真实Pi SDK与注入SSE/usage，没有读取真实密钥或调用供应商。SHA不是签名。',
  '', '| 岗位 | 子进程退出 | 结果/事件/预算逐项重放 | 恢复HTTP/凭证读取 | 续答HTTP | 观测数 | 合成token | 准入run次数 |','|---|---|---|---|---|---|---|---|',
  ...rows.map(r=>`| ${r.role} | ${r.childExitCode} | ${r.exactResultReplay}/${r.exactEventReplay}/${r.exactBudgetReplay} | ${r.replayHttpAttempts}/${r.replayCredentialReads} | ${r.continuationHttpAttempts} | ${r.observations} | ${r.totalSettledTokens} | ${r.authorizationRunsUsed} |`),
  '', '旧run重放不派发，合法追加产生一次新评估，重复新run不再计量；改写原答在模型前失败，同run改请求冲突。',
  '改写失败仍占用一个任务准入run次数，但没有新增HTTP/token台账。每岗260是两条per-run台账的合成usage汇总，不是供应商账单或跨会话全局预算保证。',
  '本次覆盖已完成澄清任务后的进程退出，不是供应商请求在途崩溃；后者仍可能unknown，不能自动重试。Agent操作记录不等于业务正式会话提交；API所有权、CAS和数据库事务另行负责。',
  '子进程输入及SQLite均为合成材料，保留在rows.output所指本地缓存，可供定位；报告不包含原回答文本。',''];
 await writeFile(join(output,'report.md'),lines.join('\n'),{flag:'wx'});
 return {output,status:report.status,digest:report.digest,checks,liveModelCalls:0,formalCommitted:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==2)throw Error();const r=await exportDurableClarificationAcceptance();console.log(JSON.stringify(r));if(r.status==='failed')process.exitCode=1;}catch{console.error('DURABLE_CLARIFICATION_ACCEPTANCE_FAILED');process.exitCode=2;}}
