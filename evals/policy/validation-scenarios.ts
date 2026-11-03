/** Fixed, hand-labeled synthetic validation cases. Never used by the reflection rule. */
import{createInterviewState,recordObservation}from'../../apps/agent/src/planning/interview-state.ts';
import type{RoleId}from'../../packages/contracts/src/tools.ts';
export function createPolicyValidationSuite(roleId:RoleId='java-backend'){
 const start=2000000;
 const make=(id:string,count:number)=>{
  let state=createInterviewState({sessionId:id,roleId,durationMinutes:20,
   skills:[{skillId:'primary',relevance:1},{skillId:'secondary',relevance:0.1}]},start);
  for(let i=0;i<count;i++)state=recordObservation(state,{observationId:`o${i}`,roleId,skillId:'primary',questionId:`q${i}`,
   questionType:'technical',difficulty:1,score:0.25,quality:1,observedAt:start+i*1000},state.version,start+i*1000);
  return state;
 };
 const a=make('validation-depth-a',2),b=make('validation-depth-b',2),wrap=make('validation-wrap',1),turn=make('validation-turn',12);
 return {version:'synthetic-policy-v1',split:'validation',evidenceMode:'synthetic',roleId,cases:[
  {id:'depth-a',groupId:'validation-depth-family',tag:'depth_boundary',state:a,now:start+2000,expected:{action:'switch_skill',skillId:'secondary'}},
  {id:'depth-b',groupId:'validation-depth-family',tag:'depth_boundary',state:b,now:start+4000,expected:{action:'switch_skill',skillId:'secondary'}},
  {id:'wrap',groupId:'validation-wrap-family',tag:'wrap_up',state:wrap,now:wrap.deadlineAt-10000,expected:{action:'finish',skillId:null}},
  {id:'turn',groupId:'validation-turn-family',tag:'turn_budget',state:turn,now:start+12000,expected:{action:'finish',skillId:null}},
 ]};
}
