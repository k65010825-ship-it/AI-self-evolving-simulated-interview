import { MemoryRecallSchema,MemoryContextAuditSchema } from '../../../../packages/contracts/src/memory.ts';
import { projectMemoryForPrompt } from '../memory/recall.ts';
import { AgentStateError } from '../planning/interview-state.ts';

type PromptMemory=ReturnType<typeof projectMemoryForPrompt>;
/** Only optional whole evidence is dropped; estimates and authorization stay with the caller's full state. */
export function fitMemoryContext(rawRecall:unknown,phase:'questioning'|'scoring',fits:(memory:PromptMemory)=>boolean){
 const p=MemoryRecallSchema.safeParse(rawRecall);if(!p.success||!['questioning','scoring'].includes(phase))throw new AgentStateError('VALIDATION_ERROR');
 const recall=p.data,memory:PromptMemory=[];
 const decisions:{sessionId:string;observationId:string;reason:string}[]=recall.excluded.map(e=>({...e}));
 const included:{sessionId:string;observationId:string}[]=[];
 for(const e of recall.selected){
  if(phase==='scoring'){decisions.push({sessionId:e.sessionId,observationId:e.observationId,reason:'scoring_isolation'});continue;}
  const entry=projectMemoryForPrompt([e])[0]!;
  if(fits([...memory,entry])){memory.push(entry);included.push({sessionId:e.sessionId,observationId:e.observationId});}
  else decisions.push({sessionId:e.sessionId,observationId:e.observationId,reason:'context_budget'});
 }
 const audit=MemoryContextAuditSchema.parse({strategy:'whole-evidence-projection-v1',sourceCount:recall.sourceCount,selectedCount:recall.selected.length,
  includedCount:memory.length,excludedCount:decisions.length,reasonCounts:decisions.reduce<Record<string,number>>((counts,d)=>{counts[d.reason]=(counts[d.reason]??0)+1;return counts;},{})});
 return{memory,audit,decisions,included};
}
