import {mkdir,mkdtemp,writeFile,readFile,lstat} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runClarificationLoop} from '../evals/clarification-loop/runner.ts';
import {verifyClarificationLoop} from '../evals/clarification-loop/report.ts';
export async function exportClarificationLoop(){
 const report=await runClarificationLoop();await verifyClarificationLoop(report);
 const root=join(process.cwd(),'.cache','clarification-loop');await mkdir(root,{recursive:true});const output=await mkdtemp(join(root,'run-'));
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 const s=report.summary;
 const lines=['# 澄清闭环离线开发评测','',`摘要：${report.digest}`,'',
  '注入输出/引用的合成机制评测；无真实模型或人工参考，不是用户效果、准确率或教学提升。SHA不是签名，verify只复核投影/源码，不重新执行评测。','',
  `结构闭合：${s.scoredAfterClarification}/${s.clarifiedRegressionSessions}；其中零分${s.zeroScoreAfterClarification}。有依据的零分也可闭合证据，但不表示能力提升。`,
  `回归${s.matched}/${s.regressions}；语义风险${s.knownLimits}单列，不进入闭合率。待澄清${s.pending}，限次弃评${s.limitAbstentions}，时间弃评${s.timeAbstentions}，取消${s.cancelled}。`,
  '', '| ID | 分组 | 逐轮结果 | 注入评估次数 |','|---|---|---|---|',
  ...report.rows.map(r=>`| ${r.id} | ${r.lane} | ${r.steps.map(s=>s.status+(s.reason?'/'+s.reason:'')).join(' → ')} | ${r.evaluatorCalls} |`),
  '', '同句旁注样例仍可评分，必须独立语义审核；模板发出不算成功。报告不保存原答/引文，默认CLI策略与正式知识不改。',''];
 await writeFile(join(output,'report.md'),lines.join('\n'),{flag:'wx'});
 return {output,digest:report.digest,status:report.status,summary:report.summary,liveModelCalls:0,qualityClaimEligible:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const args=process.argv.slice(2);
  if(args.length===2&&args[0]==='--verify'&&basename(args[1]!)==='report.json'){
   const stat=await lstat(args[1]!);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)throw Error();
   const r=await verifyClarificationLoop(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(args[1]!))));console.log(JSON.stringify({verified:true,digest:r.digest,rerun:false}));
  }else if(!args.length){const r=await exportClarificationLoop();console.log(JSON.stringify(r));if(r.status==='failed-regressions')process.exitCode=1;}
  else throw Error();
 }catch{console.error('CLARIFICATION_LOOP_INVALID');process.exitCode=2;}
}
