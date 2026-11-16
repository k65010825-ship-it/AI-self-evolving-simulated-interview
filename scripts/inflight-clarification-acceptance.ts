import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runInflightClarificationAcceptance} from '../experiments/durable-clarification/inflight-acceptance.ts';
import {collectDeliverySources} from '../evals/delivery/sources.ts';
import {contentHash} from '../evals/answers/validation.ts';
export async function exportInflightClarificationAcceptance(){
 const before=await collectDeliverySources(process.cwd()),rows=[];
 for(const role of ['java-backend','web-frontend']as const)rows.push(await runInflightClarificationAcceptance(role));
 const sourceManifest=await collectDeliverySources(process.cwd());if(contentHash(before)!==contentHash(sourceManifest))throw Error('INFLIGHT_CLARIFICATION_SOURCE_CHANGED');
 const checks=rows.map(r=>({role:r.role,passed:r.childExitCode===23&&r.childHttpAttempts===2&&r.pendingReceiptRetained&&r.originalBudgetRetained
  &&r.taskAfterRecovery==='interrupted'&&r.oldResultStatus==='failed'&&r.unknownHeldTokens>0&&r.reservationPreserved
  &&r.recoveryHttpAttempts===0&&r.recoveryCredentialReads===0&&r.blockedBeforeReconcile&&r.staleVersionRejected&&r.wrongIdentityRejected&&r.invalidReconcileUnchanged
  &&r.reconciliationKind==='reconciled'&&r.reconciliationReplayKind==='replayed'&&r.reconciliationReceiptStable&&r.conflictingUsageRejected&&r.reconciledBudgetPersisted
  &&r.oldTaskStillFailed&&r.oldResultReplayIdentical&&r.newTaskStatus==='completed'&&r.newTaskObservations===1&&r.newHttpAttempts===1&&r.newTaskReplayUnchanged&&r.totalSyntheticTokens===390}));
 const body={version:1,origin:'synthetic-injected-transport',sourceManifest,rows,checks,status:checks.every(c=>c.passed)?'passed-offline-mechanism-checks':'failed',liveModelCalls:0,formalCommitted:false,qualityClaimEligible:false};
 const report={...body,digest:contentHash(body)},root=join(process.cwd(),'.cache','inflight-clarification-acceptance');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'run-'));
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 const lines=['# 澄清续答在途崩溃与对账验收','',`摘要：${report.digest}`,'',
  '真实子进程先完成定向澄清，再在续答fetch派发后exit23；真实SQLite重开及过期租约恢复。Pi SDK参与，fetch/usage/凭证注入，无真实供应商调用。',
  '', '| 岗位 | 退出码 | 预留保持 | 恢复HTTP/凭证 | 原回执保持 | 对账幂等且持久 | 旧失败不变 | 新任务HTTP/观测 | 合成token汇总 |','|---|---|---|---|---|---|---|---|---|',
  ...rows.map(r=>`| ${r.role} | ${r.childExitCode} | ${r.reservationPreserved} | ${r.recoveryHttpAttempts}/${r.recoveryCredentialReads} | ${r.pendingReceiptRetained} | ${r.reconciliationReplayKind}/${r.reconciledBudgetPersisted} | ${r.oldResultReplayIdentical} | ${r.newHttpAttempts}/${r.newTaskObservations} | ${r.totalSyntheticTokens} |`),
  '', 'unknown保留预留并阻止新调用；身份错误、版本过期和冲突usage对账拒绝。有效对账重启后仍可重放相同回执，不重新结算。',
  '对账只解决消耗状态，不补造模型结果、不重发旧请求；旧失败快照保持，显式新run才可评估。',
  '390是初次130、崩溃请求的宿主合成对账130、新run130的per-run聚合；不是真实账单、供应商验证或跨会话全局预算。reconciliation authority为host-supplied-usage-not-vendor-verified。',
  '租约到期通过注入宿主时钟推进；未模拟真实供应商迟到账单、网络分区或电源断电。正式API权限/CAS/事务仍另行负责，摘要不是签名或执行身份认证。',''];
 await writeFile(join(output,'report.md'),lines.join('\n'),{flag:'wx'});
 return {output,status:report.status,digest:report.digest,checks,liveModelCalls:0,formalCommitted:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==2)throw Error();const r=await exportInflightClarificationAcceptance();console.log(JSON.stringify(r));if(r.status==='failed')process.exitCode=1;}catch{console.error('INFLIGHT_CLARIFICATION_ACCEPTANCE_FAILED');process.exitCode=2;}}
