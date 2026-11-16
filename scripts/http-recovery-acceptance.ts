import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runHttpRecoveryAcceptance} from '../experiments/durable-clarification/http-acceptance.ts';
import {collectDeliverySources} from '../evals/delivery/sources.ts';
import {contentHash} from '../evals/answers/validation.ts';
export async function exportHttpRecoveryAcceptance(){
 const before=await collectDeliverySources(process.cwd()),rows=[];
 for(const role of ['java-backend','web-frontend']as const)rows.push(await runHttpRecoveryAcceptance(role));
 const sourceManifest=await collectDeliverySources(process.cwd());if(contentHash(before)!==contentHash(sourceManifest))throw Error('HTTP_RECOVERY_SOURCE_CHANGED');
 const checks=rows.map(r=>({role:r.role,passed:r.pendingTemplate==='observation-v1'&&r.failedExecuteCode==='DEPENDENCY_UNAVAILABLE'&&r.failedExecutePosts===1
  &&r.blockedExecuteCode==='DEPENDENCY_UNAVAILABLE'&&r.blockedExecutePosts===1&&r.sseReconnectRequests===2&&r.lastEventIdUsed&&r.contiguousEvents
  &&r.restartTailMatches&&r.restartBudgetMatches&&r.wrongAttemptRejected&&r.futureCursorRejected&&r.preReconcileModelAttempts===0&&r.preReconcileCredentialReads===0
  &&r.newTaskStatus==='completed'&&r.newTaskEventsObserved&&r.newTaskObservations===1&&r.newModelAttempts===1&&r.duplicateBudgetUnchanged&&r.oldFailedStillFailed&&r.totalSyntheticTokens===390}));
 const body={version:1,origin:'synthetic-model-transport-with-real-local-tcp',sourceManifest,rows,checks,status:checks.every(c=>c.passed)?'passed-offline-mechanism-checks':'failed',liveModelCalls:0,formalCommitted:false,qualityClaimEligible:false};
 const report={...body,digest:contentHash(body)},root=join(process.cwd(),'.cache','http-recovery-acceptance');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'run-'));
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 const lines=['# 澄清崩溃恢复 HTTP/SSE 与内部客户端验收','',`摘要：${report.digest}`,'',
  '真实子进程崩溃、SQLite恢复及127.0.0.1 TCP/Hono/内部客户端；模型凭证、fetch和usage均注入，真实供应商调用0。',
  '', '| 岗位 | 失败POST/阻断POST | SSE请求数/游标有效 | 顺序无重复 | 重建后尾部/预算 | 对账前模型/凭证 | 新run模型/观测 | 重复预算不变 |','|---|---|---|---|---|---|---|---|',
  ...rows.map(r=>`| ${r.role} | ${r.failedExecutePosts}/${r.blockedExecutePosts} | ${r.sseReconnectRequests}/${r.lastEventIdUsed} | ${r.contiguousEvents} | ${r.restartTailMatches}/${r.restartBudgetMatches} | ${r.preReconcileModelAttempts}/${r.preReconcileCredentialReads} | ${r.newModelAttempts}/${r.newTaskObservations} | ${r.duplicateBudgetUnchanged} |`),
  '', '一次SSE响应在完整帧后被客户端传输夹具截断，再由现有客户端自动续订；没有伪造事件。服务实例/SQLite关闭重建后，新客户端显式携带保存的afterSeq续订。未证明客户端自动持久化游标、跨代理故障转移或真实网络分区。',
  '错误attempt拒绝、未来游标冲突；失败execute和unknown阻断均不自动POST新run，retryable提示不是创建新任务的授权。',
  '对账仍为受控宿主直接方法，没有新增对账HTTP或业务接口。对账后新run经HTTP/SSE完成，重复不计量，旧失败保持。390仅为三条per-run合成usage聚合，不是账单或跨会话全局额度。',
  '所有结果为Agent候选，正式业务提交false；摘要不是签名或执行身份认证。',''];
 await writeFile(join(output,'report.md'),lines.join('\n'),{flag:'wx'});
 return {output,status:report.status,digest:report.digest,checks,liveModelCalls:0,formalCommitted:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==2)throw Error();const r=await exportHttpRecoveryAcceptance();console.log(JSON.stringify(r));if(r.status==='failed')process.exitCode=1;}catch{console.error('HTTP_RECOVERY_ACCEPTANCE_FAILED');process.exitCode=2;}}
