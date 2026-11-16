import { createHash } from 'node:crypto';
import { LiveServiceConfigSchema } from '../../packages/contracts/src/live-model.ts';
import { createLiveRunManager } from '../../apps/agent/src/runtime/live-runtime.ts';
import { estimateCostMicros } from '../../apps/agent/src/model-access/preflight.ts';
import type { LiveModelDependencies } from '../../apps/agent/src/model-access/bailian-provider.ts';
import type { AgentRunRequest,AgentRunSnapshot } from '../../packages/contracts/src/agent-run.ts';
import { acceptanceSample } from './samples.ts';

export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function prepareBailianAcceptance(raw:unknown,now=Date.now()) {
 const p=LiveServiceConfigSchema.safeParse(raw);if(!p.success||!Number.isSafeInteger(now)||now<0)throw Error('ACCEPTANCE_CONFIG_INVALID');
 const c=p.data,l=c.profile.limits,issues:string[]=[];
 const attempts=c.questionDelivery==='natural-bridge'?4:3;
 if(!c.authorization.enabled||!c.authorization.operatorApproved||now>=c.authorization.expiresAt)issues.push('AUTHORIZATION_REQUIRED');
 if(c.authorization.maxRuns<2||c.planning!=='pi-knowledge'||l.maxCalls<attempts)issues.push('TWO_ROLE_TOOL_LOOP_REQUIRED');
 const perCall=estimateCostMicros(c.profile.pricing.rates,l.maxInputTokens,l.maxOutputTokens);
 if(l.maxTotalTokens<attempts*(l.maxInputTokens+l.maxOutputTokens)||l.maxCostMicros<attempts*perCall)issues.push(attempts===3?'THREE_ATTEMPT_RESERVATION_REQUIRED':'FOUR_ATTEMPT_RESERVATION_REQUIRED');
 return{suiteId:'bailian-smoke-v1' as const,sampleCount:2,configDigest:digest(c),providerId:c.profile.providerId,modelId:c.profile.modelId,
  outputRepair:c.outputRepair,evidenceGrounding:c.evidenceGrounding,questionDelivery:c.questionDelivery,recovery:c.recovery,readyToExecute:issues.length===0,issues,credentialInspection:'not-performed' as const,networkAccess:'not-performed' as const,
  limits:{maxHttpAttempts:2*l.maxCalls,maxDeclaredCostMicros:2*l.maxCostMicros,currency:'CNY' as const},
  semanticQuality:'pending-human-review' as const,naturalFollowupVerified:false as const};
}
export async function runBailianAcceptance(raw:unknown,deps:LiveModelDependencies,options:{execute?:boolean;signal?:AbortSignal}={}) {
 const clock=deps.now??Date.now,plan=prepareBailianAcceptance(raw,clock());
 if(!options.execute)return{mode:'plan-only' as const,plan};
 if(!plan.readyToExecute)throw Error('ACCEPTANCE_NOT_AUTHORIZED_OR_READY');
 const c=LiveServiceConfigSchema.parse(raw),runtime=createLiveRunManager({...c,authorization:{...c.authorization,maxRuns:2}},deps);
 const cases:{roleId:string;requestDigest:string;input:AgentRunRequest;snapshot:AgentRunSnapshot;durationMs:number;mechanicsPassed:boolean}[]=[];
 let active:AgentRunRequest|undefined;
 const cancel=()=>{if(active)runtime.cancel(active.context.runId,active.context.attemptId);};
 options.signal?.addEventListener('abort',cancel,{once:true});
 try{
  for(const roleId of ['java-backend','web-frontend'] as const){
   if(options.signal?.aborted)break;
   const startedAt=clock(),request=acceptanceSample(roleId,startedAt,Math.min(startedAt+c.profile.limits.timeoutMs,c.authorization.expiresAt));
   active=request;runtime.start(request);await runtime.wait(request.context.runId);
   const snapshot=runtime.snapshot(request.context.runId),r=snapshot.result;
   const mechanicsPassed=snapshot.status==='completed'&&r?.kind==='uncommitted-turn-result'&&r.selection.status==='selected'
    &&r.planning?.receipts.some(receipt=>receipt.toolName==='query_role_knowledge'&&receipt.status==='ok')===true
    &&(c.questionDelivery==='canonical'||r.delivery?.status==='generated');
   cases.push({roleId,requestDigest:digest(request),input:request,snapshot,durationMs:Math.max(0,clock()-startedAt),mechanicsPassed});
   active=undefined;if(!mechanicsPassed)break;
  }
  const accounting=runtime.modelAccounting(),allEntries=accounting.flatMap(s=>s.entries);
  return{mode:deps.fetch?'injected-http' as const:'live-http' as const,plan,
   status:cases.length===2&&cases.every(c=>c.mechanicsPassed)?'passed-mechanics' as const:options.signal?.aborted?'cancelled' as const:'failed' as const,
   cases,accounting,evaluationDiagnostics:runtime.evaluationDiagnostics(),recoveryDiagnostics:runtime.recoveryDiagnostics(),httpAttempts:allEntries.filter(e=>e.status!=='reserved'&&e.status!=='released').length,
   settledTokens:accounting.reduce((n,s)=>n+s.totals.usedTokens,0),
   declaredCostMicros:accounting.reduce((n,s)=>n+s.totals.usedCostMicros,0),
   heldCostMicros:accounting.reduce((n,s)=>n+s.totals.heldCostMicros,0),
   humanReview:{status:'pending' as const,referenceScores:null,semanticQuality:null},
   naturalBridgeGenerated:cases.length===2&&cases.every(c=>c.snapshot.result?.kind==='uncommitted-turn-result'&&c.snapshot.result.delivery?.status==='generated'),
   naturalFollowupVerified:false as const,vendorBillingVerified:false as const,committed:false as const};
 }finally{options.signal?.removeEventListener('abort',cancel);runtime.dispose();}
}
