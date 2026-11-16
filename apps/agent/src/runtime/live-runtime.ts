import { createHash } from 'node:crypto';
import { LiveServiceConfigSchema } from '../../../../packages/contracts/src/live-model.ts';
import { createModelBudgetGate } from '../model-access/budget.ts';
import { createBailianPiRuntime,assertLiveAuthorized,type LiveModelDependencies } from '../model-access/bailian-provider.ts';
import { createPiEvaluator } from '../adapters/pi/evaluator.ts';
import { createPiQuestionPlanner } from '../adapters/pi/question-planner.ts';
import { createRunManager } from './run-manager.ts';
import {AgentStateError}from'../planning/interview-state.ts';
import {EvaluationDiagnosticSchema,type EvaluationDiagnostic}from'../../../../packages/contracts/src/evaluation-diagnostic.ts';
import{createPiQuestionDelivery}from'../adapters/pi/question-delivery.ts';
import{estimateCostMicros}from'../model-access/preflight.ts';
import type{BridgeGenerationRequest}from'../../../../packages/contracts/src/question-delivery.ts';
import{ModelRecoveryEventSchema,type ModelRecoveryEvent}from'../../../../packages/contracts/src/model-recovery.ts';
import{ensureModelAttemptBudget}from'../model-access/recovery.ts';
import {diagnose} from '../evaluation/diagnostic.ts';
/** Construction never reads a credential. Each run receives its own host-bound in-memory ledger. */
export function createLiveRunManager(raw:unknown,deps:LiveModelDependencies){
 const p=LiveServiceConfigSchema.safeParse(raw);if(!p.success||typeof deps.readCredential!=='function')throw Error('LIVE_MODEL_CONFIG_INVALID');
 const c=p.data,now=deps.now??Date.now;assertLiveAuthorized(c,now());
 const gates:ReturnType<typeof createModelBudgetGate>[]=[];
 const outputDiagnostics=new Map<string,EvaluationDiagnostic[]>();
 const recoveries=new Map<string,ModelRecoveryEvent[]>();
 const blocked=()=>deps.hasBlockedAccounting?.()??gates.some(g=>{const s=g.snapshot();return s.locked||s.entries.some(e=>e.status==='unknown');});
 const pseudo=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,40);
 const manager=createRunManager({now,...(deps.previewEditorsFor?{previewEditorsFor:deps.previewEditorsFor}:{}),...(deps.onRunCheckpoint?{onCheckpoint:deps.onRunCheckpoint}:{}),evaluateForRole:()=>{throw Error('LIVE_CONTEXT_REQUIRED');},forRun:context=>{
  assertLiveAuthorized(c,now());
  if(blocked())throw new AgentStateError('DEPENDENCY_UNAVAILABLE');
  const events:EvaluationDiagnostic[]=[];outputDiagnostics.set(context.runId,events);
  const recoveryEvents:ModelRecoveryEvent[]=[];recoveries.set(context.runId,recoveryEvents);
  const onRecovery=(event:ModelRecoveryEvent)=>{
   if(!['queued','running'].includes(manager.snapshot(context.runId).status)||now()>=Math.min(context.deadlineAt,c.authorization.expiresAt)||recoveryEvents.length>=64)return;
   const parsed=ModelRecoveryEventSchema.safeParse(event);if(parsed.success)recoveryEvents.push(parsed.data);
   try{deps.onRecovery?.(event);}catch{/* telemetry only */}
  };
  const onDiagnostic=(event:EvaluationDiagnostic)=>{
   const status=manager.snapshot(context.runId).status;
   if(!['queued','running'].includes(status)||now()>=Math.min(context.deadlineAt,c.authorization.expiresAt)||events.length>=16)return;
   const parsed=EvaluationDiagnosticSchema.safeParse(event);if(parsed.success){events.push(parsed.data);deps.onEvaluationDiagnostic?.(context,structuredClone(parsed.data));}
  };
  const gate=createModelBudgetGate(c.profile,{budgetId:pseudo(context.runId+':'+context.attemptId),userId:pseudo(context.userId),roleId:context.roleId,
   runId:pseudo(context.runId),attemptId:pseudo(context.attemptId),deadlineAt:Math.min(context.deadlineAt,c.authorization.expiresAt)},{now,allowLive:true,
   ...(deps.onBudgetCheckpoint?{onCheckpoint:s=>deps.onBudgetCheckpoint!(context,s,c.profile)}:{})});gates.push(gate);
  const backends=new Map<string,ReturnType<typeof createBailianPiRuntime>>();
   const prepare=(evaluation=false)=>{const mode=evaluation&&c.evaluationResponseFormat==='json_object'?'json_object':'text';let backend=backends.get(mode);if(!backend){backend=createBailianPiRuntime(c,gate,{...deps,onRecovery,onCompletion:detail=>{
    diagnose(onDiagnostic,'transport','observed','wire-completion-observed',undefined,{wireCompletion:detail});
    return deps.onCompletion?.(detail);
   },canDispatch:()=>!blocked()&&(deps.canDispatch?.()??true)&&(deps.canDispatchRun?.(context)??true)},mode==='json_object'?{responseFormat:'json_object',onDiagnostic}:{});backends.set(mode,backend);}return backend;};
  return{onDiagnostic,evaluate:async(request,signal)=>{const b=await prepare(true);return createPiEvaluator({cwd:deps.assetsRoot??process.cwd(),modelRuntime:b.runtime,model:b.model,roleId:context.roleId,
   outputRepair:c.outputRepair,evidenceGrounding:c.evidenceGrounding,...(c.verificationExtraction?{verificationExtraction:c.verificationExtraction}:{}),onDiagnostic,recovery:c.recovery,onRecovery,now,beforeRepair:()=>{assertLiveAuthorized(c,now());ensureModelAttemptBudget(gate);},
   timeoutMs:c.profile.limits.timeoutMs,maxOutputCharacters:c.profile.limits.maxOutputCharacters,maxRequestCharacters:c.profile.limits.maxInputCharacters})(request,signal);},
   ...(c.questionDelivery==='natural-bridge'?{deliver:async(request:BridgeGenerationRequest,signal:AbortSignal)=>{
    if(signal.aborted)throw new AgentStateError('RUN_CANCELLED');if(blocked())throw new AgentStateError('DEPENDENCY_UNAVAILABLE');
    const s=gate.snapshot(),l=c.profile.limits,cost=estimateCostMicros(c.profile.pricing.rates,l.maxInputTokens,l.maxOutputTokens);
    if(s.totals.callsConsumed>=l.maxCalls||s.totals.activeSlots>=l.maxConcurrent||s.totals.usedTokens+s.totals.heldTokens+l.maxInputTokens+l.maxOutputTokens>l.maxTotalTokens
     ||s.totals.usedCostMicros+s.totals.heldCostMicros+cost>l.maxCostMicros)throw new AgentStateError('TOOL_BUDGET_EXCEEDED');
    const b=await prepare();try{return await createPiQuestionDelivery({cwd:deps.assetsRoot??process.cwd(),modelRuntime:b.runtime,model:b.model,
     timeoutMs:Math.min(8000,l.timeoutMs),maxInputCharacters:Math.min(40000,l.maxInputCharacters)})(request,signal);}
    catch(e){if(blocked())throw new AgentStateError('DEPENDENCY_UNAVAILABLE');throw e;}
   }}:{}),
   ...(c.planning==='pi-knowledge'?{plan:async(input,signal)=>{const b=await prepare();return createPiQuestionPlanner({cwd:deps.assetsRoot??process.cwd(),modelRuntime:b.runtime,model:b.model,
     timeoutMs:Math.min(30000,c.profile.limits.timeoutMs)})(input,signal);}}:{})};
 }},{maxRuns:c.authorization.maxRuns,maxActiveRuns:Math.min(c.authorization.maxRuns,4),timeoutMs:c.profile.limits.timeoutMs});
 return{...manager,modelAccounting:()=>gates.map(g=>g.snapshot()),evaluationDiagnostics:()=>structuredClone([...outputDiagnostics].map(([runId,events])=>({runId,events}))),
  recoveryDiagnostics:()=>structuredClone([...recoveries].map(([runId,events])=>({runId,events})))};
}
