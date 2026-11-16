import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readQualityBatch,type QualityBatch} from './dataset.ts';
import {canonical,contentHash} from '../answers/validation.ts';
import {LiveServiceConfigSchema} from '../../packages/contracts/src/live-model.ts';
import {AgentRunRequestSchema,type AgentRunRequest,type AgentRunSnapshot} from '../../packages/contracts/src/agent-run.ts';
import type {UnscoredTurn} from '../../packages/contracts/src/clarification.ts';
import {createInterviewState} from '../../apps/agent/src/planning/interview-state.ts';
import {selectNextQuestion} from '../../apps/agent/src/planning/select-question.ts';
import {createDurableLiveRunManager} from '../../apps/agent/src/runtime/durable-runtime.ts';
import type {LiveModelDependencies} from '../../apps/agent/src/model-access/bailian-provider.ts';
import {estimateCostMicros} from '../../apps/agent/src/model-access/preflight.ts';
import {z} from 'zod';
import {EvaluationDiagnosticSchema,type EvaluationDiagnostic} from '../../packages/contracts/src/evaluation-diagnostic.ts';
type Stage='wrong'|'ambiguous'|'supplement';
const DiagnosticRecord=z.object({requestDigest:z.string().regex(/^[a-f0-9]{64}$/),events:z.array(EvaluationDiagnosticSchema).max(16)}).strict();
function request(b:QualityBatch,s:QualityBatch['samples'][number],stage:Stage,deadline:number,startedAt:number,previous?:UnscoredTurn):AgentRunRequest{
 const session=stage==='wrong'?'wrong':'clarify',state=createInterviewState({sessionId:`quality-${b.id}-${s.role}-${session}`,roleId:s.role,durationMinutes:25,skills:[{skillId:s.item.skillId,relevance:1}]},startedAt);
 const selection=selectNextQuestion({state,now:startedAt,knowledge:[s.item],askedQuestionIds:[]},{allowDraftKnowledge:true});if(selection.status!=='selected')throw Error('QUALITY_SAMPLE_INVALID');
 const runId=`quality-${b.id}-${s.role}-${stage}`,context={userId:'synthetic-quality-batch',roleId:s.role,runId,attemptId:stage,deadlineAt:deadline};
 return AgentRunRequestSchema.parse({inputSnapshotId:runId,context,job:{type:'turn',allowDraftKnowledge:true,knowledge:[],askedQuestionIds:[s.item.id],clarification:previous?{previous}:{},
  input:{state,expectedVersion:0,observationId:'observation-'+session,goal:'开发草案的结构化评分与澄清验收，不证明真实能力或独立质量',context,question:selection.question,rubric:selection.rubric,
   answer:{id:'answer-'+stage,text:stage==='supplement'?s.ambiguous+'\n'+s.supplement:s[stage]},quality:1,knowledge:[]}}});
}
async function readJson(path:string){const bytes=await readFile(path);if(bytes.length>4*1024*1024)throw Error('QUALITY_FILE_INVALID');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
async function pinnedRequest(dir:string,key:string,build:(deadline:number)=>AgentRunRequest,deadline:number){
 const path=join(dir,key+'.request.json');let existing:AgentRunRequest|undefined;
 try{existing=AgentRunRequestSchema.parse(await readJson(path));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 if(existing){if(canonical(existing)!==canonical(build(existing.context.deadlineAt)))throw Error('QUALITY_REQUEST_CHANGED');return existing;}
 const r=build(deadline);try{await writeFile(path,JSON.stringify(r,null,2)+'\n',{flag:'wx'});return r;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;return pinnedRequest(dir,key,build,deadline);}
}
export async function executeQualityBatch(dir:string,rawConfig:unknown,deps:LiveModelDependencies,options:{execute?:boolean}={}){
 const batch=await readQualityBatch(dir),c=LiveServiceConfigSchema.parse(rawConfig),now=deps.now??Date.now;
 const perCall=estimateCostMicros(c.profile.pricing.rates,c.profile.limits.maxInputTokens,c.profile.limits.maxOutputTokens);
 if(canonical(c.profile)!==canonical(batch.profile)||c.authorization.maxRuns!==6||c.planning!=='deterministic'||c.questionDelivery!=='canonical'||!['none','json-fence-only'].includes(c.outputRepair)||
  c.recovery.httpMaxAttempts!==1||c.recovery.maxModelRepairs!==0||c.recovery.maxOutputRecoveries!==0||c.recovery.maxContextCompactions!==0||c.recovery.autoCompact.enabled||perCall*6>batch.maxDeclaredCostMicros)throw Error('QUALITY_CONFIG_INVALID');
 if(!c.authorization.enabled||!c.authorization.operatorApproved||now()>=c.authorization.expiresAt)throw Error('QUALITY_AUTHORIZATION_REQUIRED');
 const pin=join(dir,'execution.json'),configDigest=contentHash(c);let existing:{batchDigest:string;configDigest:string;startedAt:number}|undefined;
 try{existing=await readJson(pin);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const validPin=(value:typeof existing)=>value&&value.batchDigest===batch.digest&&value.configDigest===configDigest&&Number.isSafeInteger(value.startedAt)&&value.startedAt<=now();
 if(existing&&!validPin(existing))throw Error('QUALITY_CONFIG_CONFLICT');
 if(!deps.fetch&&!options.execute)throw Error('QUALITY_EXECUTION_REQUIRED');
 if(!existing){const proposed={batchDigest:batch.digest,configDigest,startedAt:now()};try{await writeFile(pin,JSON.stringify(proposed)+'\n',{flag:'wx'});existing=proposed;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;existing=await readJson(pin);if(!validPin(existing))throw Error('QUALITY_CONFIG_CONFLICT');}}
 const startedAt=existing!.startedAt;
 const runtime=createDurableLiveRunManager(c,deps,{path:join(dir,'agent.sqlite'),ownerId:randomUUID()}),rows:{role:string;stage:Stage;requestDigest:string;snapshot:AgentRunSnapshot;diagnostics:EvaluationDiagnostic[];diagnosticsCaptured:boolean}[]=[];
 let stoppedForAccounting=false;
 const blocked=()=>runtime.modelAccounting().some(s=>s.locked||s.entries.some(e=>e.status==='unknown'||e.status==='dispatched'));
 const save=async()=>{
  const accounting=runtime.modelAccounting(),entries=accounting.flatMap(s=>s.entries),summary={jobs:rows.length,httpAttempts:entries.filter(e=>!['reserved','released'].includes(e.status)).length,
   clarificationsIssued:rows.filter(r=>r.stage==='ambiguous'&&r.snapshot.result?.kind==='uncommitted-unscored-turn-result'&&r.snapshot.result.resolution.status==='needs_clarification').length,
   supplementsScored:rows.filter(r=>r.stage==='supplement'&&r.snapshot.result?.kind==='uncommitted-turn-result').length,failedJobs:rows.filter(r=>r.snapshot.status==='failed').length,
   usedTokens:accounting.reduce((n,s)=>n+s.totals.usedTokens,0),heldTokens:accounting.reduce((n,s)=>n+s.totals.heldTokens,0),declaredCostMicros:accounting.reduce((n,s)=>n+s.totals.usedCostMicros,0),heldCostMicros:accounting.reduce((n,s)=>n+s.totals.heldCostMicros,0),stoppedForAccounting};
  const body={version:1,batchDigest:batch.digest,configDigest,startedAt,mode:deps.fetch?'injected-http':'live-http',rows,accounting,summary,humanReferenceCount:0,qualityClaimEligible:false as const,vendorBillingVerified:false,semanticQuality:'pending-independent-review',formalCommitted:false};
  const report={...body,digest:contentHash(body)};await writeFile(join(dir,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
 };
 try{
  outer:for(const s of batch.samples){let previous:UnscoredTurn|undefined;
   for(const stage of ['wrong','ambiguous','supplement']as const){
    if(stage==='supplement'&&!previous)continue;
    const key=s.role+'-'+stage,req=await pinnedRequest(dir,key,d=>request(batch,s,stage,d,startedAt,previous),Math.min(now()+c.profile.limits.timeoutMs,startedAt+25*60000,c.authorization.expiresAt));
    if(req.context.deadlineAt>Math.min(startedAt+25*60000,c.authorization.expiresAt))throw Error('QUALITY_REQUEST_CHANGED');
    const existing=runtime.durableTasks(req.context.runId);
    if(blocked()&&!existing){stoppedForAccounting=true;break outer;}
    runtime.start(req);await runtime.wait(req.context.runId);const snapshot=runtime.snapshot(req.context.runId),requestDigest=contentHash(req);
    const path=join(dir,key+'.diagnostics.json'),fresh=runtime.evaluationDiagnostics().find(d=>d.runId===req.context.runId)?.events;
    let diagnostics:EvaluationDiagnostic[]=[],diagnosticsCaptured=false;
    if(fresh?.length){const record=DiagnosticRecord.parse({requestDigest,events:fresh});await writeFile(path,JSON.stringify(record,null,2)+'\n',{flag:'wx'});diagnostics=record.events;diagnosticsCaptured=true;}
    else{try{const record=DiagnosticRecord.parse(await readJson(path));if(record.requestDigest!==requestDigest)throw Error('QUALITY_DIAGNOSTICS_CONFLICT');diagnostics=record.events;diagnosticsCaptured=true;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
    rows.push({role:s.role,stage,requestDigest,snapshot,diagnostics,diagnosticsCaptured});
    await save();
    if(stage==='ambiguous'&&snapshot.result?.kind==='uncommitted-unscored-turn-result'&&snapshot.result.resolution.status==='needs_clarification')previous=snapshot.result.resolution;
    if(blocked()){stoppedForAccounting=true;break outer;}
   }
  }
  const report=await save();
  const lines=['# 双岗位模型评分与澄清逐例观察','',`模式：${report.mode}；批次：${batch.id}；摘要：${report.digest}`,'',
   'AI合成development样例与草案量规；人工参考0。调用/结构通过不等于评分正确，所有语义质量待独立审核。费用按声明费率估算，不是供应商账单。',
   '',`请求${report.summary.httpAttempts}/6；已结token ${report.summary.usedTokens}；保留token ${report.summary.heldTokens}；unknown阻断=${stoppedForAccounting}。`,'',
   '| 岗位 | 阶段 | 状态 | 结果 |','|---|---|---|---|',...rows.map(r=>`| ${r.role} | ${r.stage} | ${r.snapshot.status} | ${r.snapshot.error?.code??r.snapshot.result?.kind??'none'} |`),''];
  for(const r of rows){const sample=batch.samples.find(s=>s.role===r.role)!;lines.push(`## ${r.role}/${r.stage}`,'',sample.item.question,'',r.stage==='supplement'?sample.ambiguous+'\n'+sample.supplement:sample[r.stage]);
   lines.push('',r.diagnosticsCaptured?'阶段诊断：'+r.diagnostics.map(d=>`${d.stage}/${d.outcome}/${d.reason}${d.schemaIssue?' '+JSON.stringify(d.schemaIssue):''}${d.quoteIssue?' '+JSON.stringify(d.quoteIssue):''}${d.bindingIssue?' '+d.bindingIssue:''}${d.jsonIssue?' '+d.jsonIssue:''}${d.bindingConflict?' '+JSON.stringify(d.bindingConflict):''}${d.jsonShape?' '+JSON.stringify(d.jsonShape):''}${d.wireCompletion?' '+JSON.stringify(d.wireCompletion):''}`).join('；'):'阶段诊断未采集，不能推断具体根因。');
   if(r.snapshot.result?.kind==='uncommitted-turn-result'){const p=r.snapshot.result.proposal;lines.push('',...p.evaluation.dimensions.map(d=>`- ${d.criterionId}：${d.score}；引用=${d.evidenceIds.join(',')}`),'','引用（须人工核对支持度）：',...p.evidence.map(e=>`- ${e.id} [${e.start},${e.end})：${e.excerpt}`));}
   else if(r.snapshot.result?.kind==='uncommitted-unscored-turn-result')lines.push('',`澄清/弃评：${r.snapshot.result.resolution.clarification??'null'}；${r.snapshot.result.resolution.reason}`);
  }
  await writeFile(join(dir,'report.md'),lines.join('\n')+'\n');return report;
 }finally{await runtime.shutdown({graceMs:1000,cancelWaitMs:1000});runtime.close();}
}
