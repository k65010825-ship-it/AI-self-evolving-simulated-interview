import {AgentStateError} from '../planning/interview-state.ts';
export type WireMessage={role:string;content?:unknown;[key:string]:unknown};
export type WirePayload={messages:WireMessage[];[key:string]:unknown};
export interface WireContextPolicy{enabled:boolean;windowTokens:number;triggerRatio:number;}
export interface WireCompactor{id:string;compactMemory:(memory:readonly unknown[])=>unknown[];}
export const defaultWireCompactors:readonly WireCompactor[]=[
 {id:'deduplicate-optional-memory',compactMemory:memory=>memory.filter((v,i)=>memory.findIndex(x=>JSON.stringify(x)===JSON.stringify(v))===i)},
 {id:'halve-optional-memory',compactMemory:memory=>memory.slice(0,Math.ceil(memory.length/2))},
 {id:'drop-optional-memory',compactMemory:()=>[]},
];
/** Conservative byte estimate, not a tokenizer or a vendor context guarantee. */
export function estimateWireTokens(payload:WirePayload){return new TextEncoder().encode(JSON.stringify(payload)).length+64*payload.messages.length;}
export function prepareWireContext<T extends WirePayload>(raw:T,policy:WireContextPolicy,outputTokens:number,reactive=false,compactors:readonly WireCompactor[]=defaultWireCompactors){
 if(typeof policy.enabled!=='boolean'||!Number.isSafeInteger(policy.windowTokens)||policy.windowTokens<=0||!Number.isFinite(policy.triggerRatio)||policy.triggerRatio<=0||policy.triggerRatio>1||
  !Number.isSafeInteger(outputTokens)||outputTokens<0||compactors.length>8||new Set(compactors.map(s=>s.id)).size!==compactors.length||compactors.some(s=>!/^[-a-z0-9]{1,64}$/.test(s.id)||typeof s.compactMemory!=='function'))throw new AgentStateError('VALIDATION_ERROR');
 const payload=structuredClone(raw),before=estimateWireTokens(payload);let compacted=false;
 const stages:{id:string;messageIndex:number;removedItems:number}[]=[];
 const triggered=reactive||policy.enabled&&before+outputTokens>=policy.windowTokens*policy.triggerRatio;
 if(triggered)for(const strategy of compactors){
  for(const [messageIndex,m] of payload.messages.entries()){
   if(m.role!=='user'||typeof m.content!=='string')continue;
   let p:Record<string,unknown>;try{p=JSON.parse(m.content);}catch{continue;}
   // Only this known planning projection has optional memory. No answers, rubrics or tool pairs.
   if(!p||typeof p!=='object'||Object.keys(p).some(k=>!['roleId','goal','plan','skills','policy','memory'].includes(k))||
    !['java-backend','web-frontend'].includes(String(p.roleId))||typeof p.goal!=='string'||!p.plan||!Array.isArray(p.skills)||!p.policy||!Array.isArray(p.memory)||!p.memory.length)continue;
   const previous=p.memory;let selected:unknown[];
   try{selected=strategy.compactMemory(structuredClone(previous));}catch{throw new AgentStateError('VALIDATION_ERROR');}
   if(!Array.isArray(selected)||selected.length>previous.length)throw new AgentStateError('VALIDATION_ERROR');
   // A plugin may select an existing subsequence, never invent, edit, duplicate or reorder evidence.
   let cursor=0;
   for(const item of selected){while(cursor<previous.length&&JSON.stringify(previous[cursor])!==JSON.stringify(item))cursor++;
    if(cursor>=previous.length)throw new AgentStateError('VALIDATION_ERROR');cursor++;}
   if(selected.length===previous.length)continue;
   m.content=JSON.stringify({...p,memory:selected});compacted=true;
   stages.push({id:strategy.id,messageIndex,removedItems:previous.length-selected.length});
  }
  if(!reactive&&estimateWireTokens(payload)+outputTokens<policy.windowTokens*policy.triggerRatio)break;
 }
 const after=estimateWireTokens(payload);
 if(policy.enabled&&after+outputTokens>policy.windowTokens)throw new AgentStateError('CONTEXT_BUDGET_EXCEEDED');
 return{payload,compacted,before,after,stages,estimate:'utf8-bytes-plus-message-overhead' as const,semanticSummary:false as const};
}
