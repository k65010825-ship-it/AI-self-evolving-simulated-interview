import{ReflectionInputSchema,ReflectionSchema,type SessionReflection}from'../../../../packages/contracts/src/reflection.ts';
import{createHash}from'node:crypto';
import{buildInterviewReport}from'../reporting/build-report.ts';
import{AgentStateError,decideNextAction}from'../planning/interview-state.ts';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const ratio=(numerator:number,denominator:number)=>({numerator,denominator,value:denominator?numerator/denominator:null});
export async function reflectSession(rawInput:unknown):Promise<SessionReflection>{
 const parsed=ReflectionInputSchema.safeParse(rawInput);if(!parsed.success)throw new AgentStateError('VALIDATION_ERROR');
 const{reportInput,baselinePolicy,generatedAt,sourceGroupId}=parsed.data;
 if(baselinePolicy.roleId!==reportInput.state.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
 if(baselinePolicy.id!==reportInput.policyVersion)throw new AgentStateError('VERSION_CONFLICT');
 if(generatedAt<reportInput.generatedAt)throw new AgentStateError('VALIDATION_ERROR');
 const report=await buildInterviewReport(reportInput);
 const ordered=reportInput.state.observations.map(o=>reportInput.turns.find(t=>t.input.observationId===o.observationId)!);
 for(const turn of ordered){
  if(!same(turn.input.planningPolicy,baselinePolicy))throw new AgentStateError('VALIDATION_ERROR');
  const time=turn.proposal.nextState.observations.at(-1)!.observedAt;
  if(!same(turn.proposal.nextAction,decideNextAction(turn.proposal.nextState,time,baselinePolicy.parameters)))throw new AgentStateError('VALIDATION_ERROR');
 }
 const relevant=reportInput.state.skills.filter(s=>s.relevance>0).map(s=>s.skillId);
 const observations=reportInput.state.observations;
 const covered=new Set(observations.filter(o=>relevant.includes(o.skillId)).map(o=>o.skillId));
 const seen=new Set(reportInput.state.priorEvidence.map(o=>o.questionId));
 const repeated:string[]=[],mismatches:string[]=[];
 let matched=0,longestSkillRun=0,run=0,previous:string|null=null;
 for(const[index,o]of observations.entries()){
  if(seen.has(o.questionId))repeated.push(o.observationId);seen.add(o.questionId);
  run=previous===o.skillId?run+1:1;previous=o.skillId;longestSkillRun=Math.max(longestSkillRun,run);
  if(index>0){const plan=ordered[index-1]!.proposal.nextAction;
   if(plan.action!=='finish'&&plan.skillId===o.skillId&&plan.difficulty===o.difficulty)matched++;else mismatches.push(o.observationId);}
 }
 const skillCoverage=ratio(covered.size,relevant.length);
 const findings:SessionReflection['findings']=[];
 if(covered.size<relevant.length)findings.push({code:'coverage_gap',observationIds:observations.map(o=>o.observationId)});
 if(repeated.length)findings.push({code:'repeated_question',observationIds:repeated});
 if(mismatches.length)findings.push({code:'plan_mismatch',observationIds:mismatches});
 if(observations.length<3)findings.push({code:'insufficient_evidence',observationIds:observations.map(o=>o.observationId)});
 const depth=baselinePolicy.parameters.maxFollowupDepth;
 const shouldAdjust=observations.length>=3&&mismatches.length===0&&skillCoverage.value!==null&&skillCoverage.value<0.75&&depth>1&&longestSkillRun>=depth+1;
 const candidateId=`depth-${depth-1}-${createHash('sha256').update(JSON.stringify([baselinePolicy,depth-1])).digest('hex').slice(0,16)}`;
 const candidate=shouldAdjust?{id:candidateId,baselineId:baselinePolicy.id,roleId:baselinePolicy.roleId,
  sourceSessionId:report.sessionId,sourceGroupId,createdAt:generatedAt,evidenceMode:report.evidenceMode,
  parameters:{...baselinePolicy.parameters,maxFollowupDepth:depth-1},
  changes:[{parameter:'maxFollowupDepth',from:depth,to:depth-1,reason:'coverage_gap_after_long_skill_run'}]}:null;
 return ReflectionSchema.parse({kind:'uncommitted-session-reflection',sessionId:report.sessionId,roleId:report.roleId,generatedAt,
  sourceGroupId,evidenceMode:report.evidenceMode,baselinePolicy,metrics:{skillCoverage,repeatRate:ratio(repeated.length,observations.length),
  planAdherence:ratio(matched,Math.max(0,observations.length-1)),longestSkillRun},findings,candidate,
  calibration:{status:'awaiting_eligible_retest',mae:null,sampleCount:0}});
}
