import{PolicyEvaluationInputSchema,PolicyEvaluationSchema,type PolicyEvaluation}from'../../../../packages/contracts/src/reflection.ts';
import{AgentStateError,decideNextAction,type NextAction}from'../planning/interview-state.ts';
import{isOneStepDepthReduction}from'../../../../packages/contracts/src/policy.ts';
const invalid=():never=>{throw new AgentStateError('VALIDATION_ERROR');};
export function evaluatePolicyCandidate(rawInput:unknown):PolicyEvaluation{
 const parsed=PolicyEvaluationInputSchema.safeParse(rawInput);if(!parsed.success)return invalid();
 const{baseline,candidate,suite,developmentGroupIds,developmentSessionIds}=parsed.data;
 if(baseline.roleId!==candidate.roleId||suite.roleId!==baseline.roleId||suite.cases.some(c=>c.state.roleId!==baseline.roleId))
  throw new AgentStateError('ROLE_FORBIDDEN');
 if(candidate.baselineId!==baseline.id)throw new AgentStateError('VERSION_CONFLICT');
 const change=candidate.changes[0]!;
 // Both objects are normalized by PlanningPolicySchema. Bind every parameter, including
 // optional/new fields, rather than maintaining a list that silently misses additions.
 if(candidate.id===baseline.id||!isOneStepDepthReduction(baseline.parameters,candidate.parameters)
  ||change.from!==baseline.parameters.maxFollowupDepth
  ||change.to!==candidate.parameters.maxFollowupDepth)return invalid();
 const development=new Set([...developmentGroupIds,candidate.sourceGroupId]);
 const sourceSessions=new Set([...developmentSessionIds,candidate.sourceSessionId]);
 if(new Set(suite.cases.map(c=>c.id)).size!==suite.cases.length||suite.cases.some(c=>development.has(c.groupId)
  ||sourceSessions.has(c.state.sessionId)||c.state.priorEvidence.some(o=>sourceSessions.has(o.sessionId))))return invalid();
 for(const c of suite.cases){
  if((c.expected.action==='finish')!==(c.expected.skillId===null)
   ||(c.expected.skillId!==null&&!c.state.skills.some(s=>s.skillId===c.expected.skillId&&s.relevance>0)))return invalid();
  if(c.tag==='wrap_up'&&(c.state.deadlineAt-c.now)/1000>baseline.parameters.wrapUpSeconds)return invalid();
  if(c.tag==='turn_budget'&&c.state.observations.length<baseline.parameters.maxTurns)return invalid();
 }
 const constraints=(c:typeof suite.cases[number],action:NextAction,parameters:typeof baseline.parameters)=>{
  const mustFinish=(c.state.deadlineAt-c.now)/1000<=parameters.wrapUpSeconds||c.state.observations.length>=parameters.maxTurns;
  const forbiddenDepth=action.action!=='finish'&&action.skillId===c.state.currentSkillId&&c.state.followupDepth>=parameters.maxFollowupDepth;
  return (mustFinish&&action.action!=='finish')||forbiddenDepth;
 };
 let baselineViolations=0,candidateViolations=0;
 const cases=suite.cases.map(c=>{
  const old=decideNextAction(c.state,c.now,baseline.parameters),next=decideNextAction(c.state,c.now,candidate.parameters);
  baselineViolations+=Number(constraints(c,old,baseline.parameters));candidateViolations+=Number(constraints(c,next,candidate.parameters));
  return{id:c.id,groupId:c.groupId,expected:c.expected,baseline:old,candidate:next,
   baselineMatched:old.action===c.expected.action&&old.skillId===c.expected.skillId,
   candidateMatched:next.action===c.expected.action&&next.skillId===c.expected.skillId};
 });
 const total=cases.length,oldMatched=cases.filter(c=>c.baselineMatched).length,newMatched=cases.filter(c=>c.candidateMatched).length;
 const groups=new Set(cases.map(c=>c.groupId)).size,regressions=cases.filter(c=>c.baselineMatched&&!c.candidateMatched).length;
 const reasons:string[]=[];
 if(total<4)reasons.push('insufficient_cases');if(groups<2)reasons.push('insufficient_groups');
 if(!suite.cases.some(c=>c.tag==='wrap_up')||!suite.cases.some(c=>c.tag==='turn_budget'))reasons.push('missing_guardrail_scenarios');
 if(newMatched<=oldMatched)reasons.push('no_improvement');if(regressions)reasons.push('paired_regressions');
 if(baselineViolations||candidateViolations)reasons.push('constraint_violation');
 return PolicyEvaluationSchema.parse({kind:'offline-policy-evaluation',suiteVersion:suite.version,evidenceMode:'synthetic',roleId:baseline.roleId,
  baselineId:baseline.id,candidateId:candidate.id,status:reasons.length?'rejected':'eligible_for_offline_experiment',deploymentStatus:'not_published',
  groups,baseline:{matched:oldMatched,total,value:oldMatched/total,constraintViolations:baselineViolations},
  candidate:{matched:newMatched,total,value:newMatched/total,constraintViolations:candidateViolations},delta:(newMatched-oldMatched)/total,
  regressions,reasons,cases});
}
