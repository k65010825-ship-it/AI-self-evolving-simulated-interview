import{WorkflowRsiInputSchema,WorkflowRsiResultSchema,type WorkflowRsiResult}from'../../../../packages/contracts/src/workflow-rsi.ts';
import{restoreInterviewWorkflow}from'../orchestration/session-workflow.ts';
import{restoreExperimentRegistry,applyExperimentOperation,pinSessionPolicy}from'./experiment-registry.ts';
import{AgentStateError}from'../planning/interview-state.ts';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** Re-derive from a verified closeout, never accept a caller-supplied candidate or grade as proof. */
export async function evaluateWorkflowRsi(raw:unknown,options:{signal?:AbortSignal;deadlineAt?:number;now?:()=>number}={}):Promise<WorkflowRsiResult>{
 const parsed=WorkflowRsiInputSchema.safeParse(raw);if(!parsed.success)throw new AgentStateError('VALIDATION_ERROR');
 const input=parsed.data,clock=options.now??Date.now,start=clock(),deadline=Math.min(options.deadlineAt??Infinity,start+10000);
 if(!Number.isSafeInteger(start)||start<0||(options.deadlineAt!==undefined&&(!Number.isFinite(options.deadlineAt)||options.deadlineAt<0)))throw new AgentStateError('VALIDATION_ERROR');
 const check=()=>{if(options.signal?.aborted)throw new AgentStateError('RUN_CANCELLED');const n=clock();
  if(!Number.isSafeInteger(n)||n<start)throw new AgentStateError('VALIDATION_ERROR');if(n>=deadline)throw new AgentStateError('DEADLINE_EXCEEDED');};check();
 if(input.now>start)throw new AgentStateError('VALIDATION_ERROR');
 const source=await restoreInterviewWorkflow(JSON.stringify(input.snapshot),input.identity);check();
 if(source.phase!=='completed'||!source.closeout)throw new AgentStateError('VERSION_CONFLICT');
 const closeout=source.closeout,reflection=closeout.reflection,candidate=reflection.candidate;
 if(input.now<closeout.generatedAt||input.nextSessionId===source.state.sessionId||source.baseMemory.sessions.some(s=>s.sessionId===input.nextSessionId))
  throw new AgentStateError('VALIDATION_ERROR');
 const identity={experimentId:input.experimentId,roleId:input.identity.roleId};
 const registry=restoreExperimentRegistry(JSON.stringify(input.registry),identity);check();
 if(registry.updatedAt>start)throw new AgentStateError('VALIDATION_ERROR');
 if(!registry.policies.some(p=>p.id===source.policy.id&&same(p,source.policy)))throw new AgentStateError('VERSION_CONFLICT');
 const prior=registry.operations.find(o=>o.operationId===input.operationId);
 if(!prior&&input.now<registry.updatedAt)throw new AgentStateError('VALIDATION_ERROR');
 const developmentGroupIds=[...new Set([...input.developmentGroupIds,closeout.sourceGroupId])].sort();
 const developmentSessionIds=[...new Set([...input.developmentSessionIds,source.state.sessionId,...source.state.priorEvidence.map(o=>o.sessionId)])].sort();
 if(developmentGroupIds.length>100||developmentSessionIds.length>100)throw new AgentStateError('VALIDATION_ERROR');
 let next=registry,evaluation:WorkflowRsiResult['evaluation']=null,status:WorkflowRsiResult['status']='skipped_no_candidate',
  operationSeq:number|null=null,recordedOutcome:WorkflowRsiResult['recordedOutcome']=null,reasons=['no_candidate'];
 if(!candidate){
  if(prior||input.expectedRegistryVersion!==registry.version)throw new AgentStateError('VERSION_CONFLICT');
 }else{
  if(!input.suite)throw new AgentStateError('VALIDATION_ERROR');
  const evaluationInput={baseline:source.policy,candidate,suite:input.suite,developmentGroupIds,developmentSessionIds};
  check();next=applyExperimentOperation(registry,{...identity,operationId:input.operationId,expectedVersion:input.expectedRegistryVersion,now:input.now,
   action:'evaluate',evaluationInput});check();
  const operation=next.operations.find(o=>o.operationId===input.operationId)!;
  if(operation.action!=='evaluate')throw new AgentStateError('VERSION_CONFLICT');
  evaluation=operation.evaluation;operationSeq=operation.seq;recordedOutcome=operation.outcome;
  status=prior?'replayed':operation.outcome==='activated'?'evaluated_activated_offline':'evaluated_rejected';reasons=evaluation.reasons;
 }
 const nextSessionPin=pinSessionPolicy(next,{...identity,sessionId:input.nextSessionId,now:prior?Math.max(input.now,next.updatedAt):input.now});check();
 const result=WorkflowRsiResultSchema.safeParse({kind:'uncommitted-workflow-rsi',scope:'offline-experiment',status,productionPublished:false,evaluationEvidenceMode:'synthetic',
  source:{sessionId:source.state.sessionId,stateVersion:source.state.version,workflowRevision:source.revision,sourceGroupId:closeout.sourceGroupId,closeoutAt:closeout.generatedAt},
  sourcePolicy:source.policy,sourceMetrics:reflection.metrics,
  isolation:{developmentGroupIds,developmentSessionIds,validationGroupIds:candidate&&input.suite?[...new Set(input.suite.cases.map(c=>c.groupId))].sort():[]},
  changes:candidate?.changes??null,evaluation,operationSeq,recordedOutcome,appliedNow:next.version!==registry.version,
  activeBefore:registry.activePolicyId,activeAfter:next.activePolicyId,registryCandidate:next,nextSessionPin,metric:'synthetic_action_skill_agreement',reasons,
  explanation:{trigger:candidate?`本场覆盖${reflection.metrics.skillCoverage.numerator}/${reflection.metrics.skillCoverage.denominator}个相关技能，最长连续${reflection.metrics.longestSkillRun}题集中于同一技能，提出降低追问深度的受限候选。`:'反思未产生符合受限规则的策略候选，不启动评测。',
   decision:status==='replayed'?'这是已处理操作的重放，只返回当前实验快照，不重新激活历史策略。':evaluation?
    `合成验证集动作/技能匹配从${evaluation.baseline.matched}/${evaluation.baseline.total}变为${evaluation.candidate.matched}/${evaluation.candidate.total}；${status==='evaluated_activated_offline'?'仅生成离线实验激活候选。':'候选未通过门槛，保留原实验策略并记录拒绝。'}`:'无候选，实验版本不变。',
   publication:'源会话固定策略保持不变；下一场仅离线pin预览，不发布正式策略或证明教学效果。'}});
 if(!result.success)throw new AgentStateError('VALIDATION_ERROR');check();return result.data;
}
