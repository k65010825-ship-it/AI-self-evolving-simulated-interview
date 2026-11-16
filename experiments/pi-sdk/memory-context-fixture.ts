import { createMemory,restoreMemory,startSessionFromMemory } from '../../apps/agent/src/memory/session-memory.ts';
import type { RoleId } from '../../packages/contracts/src/tools.ts';
export function restoredScenario(roleId:RoleId,now:number){
 const skill=roleId==='java-backend'?'spring-transactions':'async-state',other=roleId==='java-backend'?'java-concurrency':'javascript';
 const identity={userId:'private-user',roleId},memory=createMemory(identity,now-1);
 const observations=[{skillId:skill,questionId:'repeated-old',score:.1,observedAt:now-100*86400000},
  {skillId:skill,questionId:'repeated-old',score:1,observedAt:now-2000},
  {skillId:skill,questionId:'weak-recent',score:.2,observedAt:now-1000},
  {skillId:other,questionId:'strong-recent',score:.9,observedAt:now-900}].map((x,i)=>({...x,sessionId:'private-old',observationId:`private-observation-${i}`,roleId,
   questionType:'technical' as const,difficulty:1,quality:1,rubricId:'original-rubric',rubricVersion:'original-1',evidenceMode:'offline-fixture' as const}));
 const snapshot={...memory,version:1,sessions:[{sessionId:'private-old',stateVersion:4,endedAt:now-1,acceptedAt:now-1,policyVersion:'p',evidenceMode:'offline-fixture',observations}]};
 const restored=restoreMemory(JSON.stringify(snapshot),identity);
 const state=startSessionFromMemory(restored,{...identity,now,session:{sessionId:'private-current',roleId,durationMinutes:20,skills:[{skillId:skill,relevance:1},{skillId:other,relevance:.1}]}});
 return{state,restored,skill,other};
}
