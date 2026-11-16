import type {AgentSessionEvent} from '@earendil-works/pi-coding-agent';
import type {AssistantMessage} from '@earendil-works/pi-ai';
import {AgentStateError} from '../planning/interview-state.ts';
export interface HarnessHook {id:string;postToolUse?:(receipt:unknown)=>void;stop?:(result:unknown)=>void;}
/** Host-owned, fail-closed gate. SDK stopping is not a validated business result. */
export function createCompletionGate(allowedTools:readonly string[],signal?:AbortSignal,hooks:readonly HarnessHook[]=[]){
 let settled=false,failed=false,final:AssistantMessage|undefined;
 const pending=new Set<string>();
 if(hooks.length>8||new Set(hooks.map(h=>h.id)).size!==hooks.length||hooks.some(h=>!/^[-a-z0-9]{1,64}$/.test(h.id)||(h.postToolUse!==undefined&&typeof h.postToolUse!=='function')||(h.stop!==undefined&&typeof h.stop!=='function')))throw new AgentStateError('VALIDATION_ERROR');
 const validators=hooks.map(h=>({...h}));
 const invoke=(callback:((value:unknown)=>void)|undefined,value:unknown)=>{
  if(!callback)return;
  const result:unknown=callback(structuredClone(value));
  if(result&&typeof(result as {then?:unknown}).then==='function'){
   void Promise.resolve(result).catch(()=>{});throw new AgentStateError('MODEL_OUTPUT_INVALID');
  }
 };
 return {
  observe(event:AgentSessionEvent){
   if(event.type==='agent_start'){settled=false;final=undefined;}
   if(event.type==='tool_execution_start'){
    if(!allowedTools.includes(event.toolName)||pending.has(event.toolCallId))failed=true;
    pending.add(event.toolCallId);
   }
   if(event.type==='tool_execution_end'){
    if(!allowedTools.includes(event.toolName)||!pending.delete(event.toolCallId)||event.isError)failed=true;
    const details=event.result?.details;
    if(details&&typeof details==='object'&&'status'in details&&details.status==='error')failed=true;
    try{for(const hook of validators)invoke(hook.postToolUse,details);}catch{failed=true;}
   }
   if(event.type==='message_end'&&event.message.role==='assistant'){
    final=event.message;
    if(final.content.some(c=>c.type==='toolCall'&&!allowedTools.includes(c.name)))failed=true;
   }
   if(event.type==='agent_settled'){settled=true;if(event.aborted)failed=true;}
  },
  accept<T>(validate:()=>T):T {
   if(signal?.aborted)throw new AgentStateError('RUN_CANCELLED');
   if(failed||!settled||pending.size||!final||final.stopReason!=='stop'||final.content.some(c=>c.type==='toolCall'))throw new AgentStateError('MODEL_OUTPUT_INVALID');
   const result=validate(); // A throw is a denied result; never swallowed as telemetry.
   if(result&&typeof(result as {then?:unknown}).then==='function'){void Promise.resolve(result).catch(()=>{});throw new AgentStateError('VALIDATION_ERROR');}
   try{for(const hook of validators)invoke(hook.stop,result);}catch{failed=true;throw new AgentStateError('MODEL_OUTPUT_INVALID');}
   if(signal?.aborted)throw new AgentStateError('RUN_CANCELLED');
   return structuredClone(result); // Only the validated result crosses the sidechain boundary.
  },
 };
}
