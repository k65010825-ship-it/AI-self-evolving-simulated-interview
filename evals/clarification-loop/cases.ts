export const scenarios=['repaired','still-missing','limit-exhausted','time-before','time-after','semantic-risk','zero-score','cancel-before'] as const;
export type Scenario=typeof scenarios[number];
export type Step={status:'needs_clarification'|'abstained'|'scored'|'cancelled';reason:'evidence_insufficient'|'clarification_limit'|'time_budget'|null;template:'observation-v1'|null;score:number|null;observations:number;evaluatorCalls:number};
const needs:Step={status:'needs_clarification',reason:'evidence_insufficient',template:'observation-v1',score:null,observations:0,evaluatorCalls:1};
const abstain=(reason:'time_budget'|'clarification_limit'):Step=>({...needs,status:'abstained',template:null,reason});
const scored=(score:number):Step=>({...needs,status:'scored',reason:null,template:null,score,observations:1});
export function expectedSteps(s:Scenario):Step[]{
 switch(s){
  case 'repaired':case 'semantic-risk':return [{...needs},scored(.75)];
  case 'still-missing':return [{...needs},{...needs}];
  case 'limit-exhausted':return [{...needs},abstain('clarification_limit')];
  case 'time-before':return [abstain('time_budget')];
  case 'time-after':return [{...needs},abstain('time_budget')];
  case 'zero-score':return [{...needs},scored(0)];
  case 'cancel-before':return [{...needs,status:'cancelled',reason:null,template:null,evaluatorCalls:0}];
 }
}
export const loopCases=(['java-backend','web-frontend']as const).flatMap(role=>scenarios.map(scenario=>({id:role+':'+scenario,role,scenario,lane:scenario==='semantic-risk'?'known-limit' as const:'regression' as const,expected:expectedSteps(scenario)})));
