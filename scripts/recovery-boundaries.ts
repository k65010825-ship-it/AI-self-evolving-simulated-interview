import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runRecoveryBoundaryCase,recoveryDecisions} from '../experiments/recovery-boundaries/cases.ts';
import {collectDeliverySources} from '../evals/delivery/sources.ts';
import {contentHash} from '../evals/answers/validation.ts';
export async function exportRecoveryBoundaries(){
 const before=await collectDeliverySources(process.cwd()),rows=[];
 for(const role of ['java-backend','web-frontend']as const)for(const c of recoveryDecisions)rows.push(await runRecoveryBoundaryCase(role,c.id));
 const sourceManifest=await collectDeliverySources(process.cwd());if(contentHash(before)!==contentHash(sourceManifest))throw Error('RECOVERY_SOURCE_CHANGED');
 const summary={cases:rows.length,passed:rows.filter(r=>r.checks.every(c=>c.passed)).length,checks:rows.reduce((sum,r)=>sum+r.checks.length,0),failedChecks:rows.reduce((sum,r)=>sum+r.checks.filter(c=>!c.passed).length,0)};
 const body={version:1,origin:'synthetic-runtime-and-sqlite-boundaries',sourceManifest,decisions:recoveryDecisions,rows,summary,status:summary.failedChecks?'failed':'passed-offline-mechanism-checks',liveModelCalls:0,formalCommitted:false,qualityClaimEligible:false};
 const report={...body,digest:contentHash(body)},root=join(process.cwd(),'.cache','recovery-boundary-acceptance');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'run-'));
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 const lines=['# 恢复动作决策与跨层边界回归','',`摘要：${report.digest}`,'',
  '两岗真实内存运行时/SQLite边界，评估输出和usage注入，真实供应商调用0。决策表描述已运行机制，不是模型可修改的重试授权。','',
  '| 触发 | 结果动作 | 消耗动作 | 重试边界 |','|---|---|---|---|',...recoveryDecisions.map(c=>`| ${c.trigger} | ${c.result} | ${c.accounting} | ${c.retry} |`),'',
  `场景${summary.passed}/${summary.cases}通过，检查${summary.checks}项，失败${summary.failedChecks}项。`,
  '', '| 岗位/场景 | 检查 |','|---|---|',...rows.map(r=>`| ${r.role}/${r.scenario} | ${r.checks.map(c=>c.id+'='+c.passed).join('；')} |`),'',
  '取消/超时等待真实依赖释放槽位，不只等待包装Promise。SQLite任务终态与事件冻结，当前有效owner可结清迟到usage；租约恰好到期时，旧owner的结果和预算写入都拒绝且不改账。',
  'reserved释放不代表旧任务可自动复活；dispatched转unknown并保留预留，对账后仍需宿主显式新run。',
  '用注入时钟测试精确租约边界，超时场景使用真实短计时器；没有验证多机时钟/网络分区、供应商账单或业务正式事务。SHA不是签名。',''];
 await writeFile(join(output,'report.md'),lines.join('\n'),{flag:'wx'});
 return {output,digest:report.digest,status:report.status,summary,liveModelCalls:0,formalCommitted:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.length!==2)throw Error();const r=await exportRecoveryBoundaries();console.log(JSON.stringify(r));if(r.status==='failed')process.exitCode=1;}catch{console.error('RECOVERY_BOUNDARY_ACCEPTANCE_FAILED');process.exitCode=2;}}
