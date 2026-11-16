import{ModelRecoveryEventSchema,type ModelRecoveryPolicy,type ModelRecoverySink,type ModelRecoveryEvent}from'../../../../packages/contracts/src/model-recovery.ts';
import{AgentStateError}from'../planning/interview-state.ts';
import type{ModelBudgetGate}from'./budget.ts';
import{estimateCostMicros}from'./preflight.ts';
export function ensureModelAttemptBudget(gate:ModelBudgetGate){
 const s=gate.snapshot(),p=gate.profile(),l=p.limits,cost=estimateCostMicros(p.pricing.rates,l.maxInputTokens,l.maxOutputTokens);
 if(s.locked||s.entries.some(e=>e.status==='unknown'))throw new AgentStateError('DEPENDENCY_UNAVAILABLE');
 if(s.totals.callsConsumed>=l.maxCalls||s.totals.activeSlots>=l.maxConcurrent||s.totals.heldTokens+s.totals.usedTokens+l.maxInputTokens+l.maxOutputTokens>l.maxTotalTokens||
  s.totals.heldCostMicros+s.totals.usedCostMicros+cost>l.maxCostMicros)throw new AgentStateError('TOOL_BUDGET_EXCEEDED');
}
export function recoveryEvent(sink:ModelRecoverySink|undefined,phase:ModelRecoveryEvent['phase'],outcome:ModelRecoveryEvent['outcome'],reason:ModelRecoveryEvent['reason'],attempt:number,delayMs=0){
 try{sink?.(ModelRecoveryEventSchema.parse({version:1,phase,outcome,reason,attempt,delayMs}));}catch{/* telemetry cannot change business results */}
}
export function retryDelay(header:string|null,attempt:number,p:ModelRecoveryPolicy,now:number,random:()=>number=Math.random):number|null{
 if(header!==null&&header.length>128)return null; // Never ignore an oversized server wait and retry early.
 const value=random();if(!Number.isFinite(value)||value<0||value>1)throw new AgentStateError('VALIDATION_ERROR');
 let delay=Math.floor(Math.min(p.maxDelayMs,p.baseDelayMs*2**(attempt-1))*(.5+.5*value));
 if(header&&header.length<=128){let requested:number|undefined;
  if(/^\d+$/.test(header.trim()))requested=Number(header.trim())*1000;
  else if(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), /.test(header)){const date=Date.parse(header);if(Number.isFinite(date))requested=Math.max(0,date-now);}
  if(requested!==undefined){if(requested>p.maxDelayMs)return null;delay=Math.max(delay,requested);}
 }
 return delay;
}
export type RecoverySleep=(ms:number,signal:AbortSignal)=>Promise<void>;
export async function waitForRecovery(delayMs:number,options:{signal:AbortSignal;deadlineAt:number;now:()=>number;sleep?:RecoverySleep}){
 const{signal,deadlineAt,now}=options;let last=-1;
 const check=()=>{if(signal.aborted)throw new AgentStateError('RUN_CANCELLED');const t=now();
  if(!Number.isSafeInteger(t)||t<0||t<last)throw new AgentStateError('VALIDATION_ERROR');last=t;
  if(t>=deadlineAt)throw new AgentStateError('DEADLINE_EXCEEDED');return t;};
 if(check()+delayMs>=deadlineAt)throw new AgentStateError('DEADLINE_EXCEEDED');
 let rejectAbort!:(error:unknown)=>void,timer:ReturnType<typeof setTimeout>|undefined,delayTimer:ReturnType<typeof setTimeout>|undefined;
 const abort=()=>rejectAbort(new AgentStateError('RUN_CANCELLED'));
 const stop=new Promise<never>((_r,reject)=>{rejectAbort=reject;signal.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>reject(new AgentStateError('DEADLINE_EXCEEDED')),Math.max(1,deadlineAt-check()));});
 try{
  check();await Promise.race([options.sleep?options.sleep(delayMs,signal):new Promise<void>(resolve=>{delayTimer=setTimeout(resolve,delayMs);}),stop]);check();
 }finally{if(timer)clearTimeout(timer);if(delayTimer)clearTimeout(delayTimer);signal.removeEventListener('abort',abort);}
}
