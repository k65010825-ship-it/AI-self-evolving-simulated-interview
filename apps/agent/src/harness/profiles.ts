import {AgentStateError} from '../planning/interview-state.ts';
export type HarnessPhase='planning'|'evaluation'|'delivery';
export type ExtensionKind='skill'|'tool-source'|'hook'|'sidecar';
const metadata={
 planning:{id:'interview-planning',description:'累计状态约束的岗位知识选题'},
 evaluation:{id:'interview-evaluation',description:'仅当前回答与固定量规的独立评分'},
 delivery:{id:'interview-delivery',description:'不修改题目的中性承接语'},
} as const;
const loaders:Record<HarnessPhase,()=>Promise<string>>={
 planning:()=>import('./skills/planning.ts').then(m=>m.prompt),
 evaluation:()=>import('./skills/evaluation.ts').then(m=>m.prompt),
 delivery:()=>import('./skills/delivery.ts').then(m=>m.prompt),
};
export function getHarnessProfile(phase:HarnessPhase){
 if(!Object.hasOwn(metadata,phase))throw new AgentStateError('VALIDATION_ERROR');
 const tools=phase==='planning'?['query_role_knowledge']:[];
 return {phase,tools,extensions:[
  {id:metadata[phase].id,kind:'skill' as ExtensionKind},
  {id:'role-knowledge-local',kind:'tool-source' as ExtensionKind,transport:'local',enabled:phase==='planning'},
  {id:'completion-gate',kind:'hook' as ExtensionKind},
  {id:`isolated-${phase}`,kind:'sidecar' as ExtensionKind},
 ]};
}
/** Metadata listing never loads prompt bodies. Only host-known modules may be loaded. */
export function createSkillCatalog(overrides:Partial<Record<HarnessPhase,()=>Promise<string>>>={}){
 const cache=new Map<HarnessPhase,Promise<string>>();
 return {
  list:()=>Object.values(metadata).map(m=>({...m})),
  load(phase:HarnessPhase):Promise<string>{
   if(!Object.hasOwn(metadata,phase))throw new AgentStateError('VALIDATION_ERROR');
   let pending=cache.get(phase);
   if(!pending){pending=Promise.resolve().then(()=> (overrides[phase]??loaders[phase])()).then(body=>{
    if(typeof body!=='string'||!body.trim()||body.length>100000)throw new AgentStateError('VALIDATION_ERROR');return body;
   }).catch(error=>{cache.delete(phase);throw error;});cache.set(phase,pending);}
   return pending;
  },
 };
}
export const harnessSkills=createSkillCatalog();
