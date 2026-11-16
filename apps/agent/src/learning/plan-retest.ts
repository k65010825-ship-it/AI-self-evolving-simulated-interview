import { PlanRetestSchema, RetestPlanSchema, type RetestPlan } from '../../../../packages/contracts/src/learning-planning.ts';
import { AgentStateError } from '../planning/interview-state.ts';
import { parseLearning, authorizeLearning, summarizeLearning } from './progress.ts';
const canonical=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(',')}]`:
 `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical((v as Record<string,unknown>)[k])}`).join(',')}}`;
/** Pre-exposure host plan; API must recheck trusted identity, versions and actual issue time before issuing. */
export function planRetestQuestion(raw:unknown):RetestPlan{
 const r=parseLearning(PlanRetestSchema,raw),p=r.prediction;authorizeLearning(p,r);authorizeLearning(r.progress,r);
 if(r.state.roleId!==r.roleId||r.candidates.some(c=>c.question.roleId!==r.roleId))throw new AgentStateError('ROLE_FORBIDDEN');
 if(r.progress.skillId!==p.skillId||canonical(r.progress.requiredExerciseIds)!==canonical(p.expectedExerciseIds))throw new AgentStateError('VALIDATION_ERROR');
 if(r.now<r.progress.updatedAt||r.now<r.state.startedAt||r.state.observations.some(o=>o.observedAt>r.now))throw new AgentStateError('VALIDATION_ERROR');
 if(new Set(r.candidates.map(c=>c.question.id)).size!==r.candidates.length)throw new AgentStateError('VALIDATION_ERROR');
 const base={kind:'uncommitted-retest-plan' as const,userId:r.userId,roleId:r.roleId,assignmentId:r.assignmentId,predictionId:p.predictionId,dataMode:p.dataMode,
  basedOn:{sessionId:r.state.sessionId,stateVersion:r.state.version,progressVersion:r.progress.version,plannedAt:r.now},excluded:[] as RetestPlan['excluded']};
 const reasons:Extract<RetestPlan,{status:'blocked'}>['reasons']=[],learning=summarizeLearning(r.progress,{userId:r.userId,roleId:r.roleId,assignmentId:r.assignmentId});
 if(learning.status!=='verified_complete')reasons.push('learning_not_verified');
 if(learning.verifiedCompleteAt!==null&&learning.verifiedCompleteAt>=r.now||r.progress.events.some(({event:e})=>e.occurredAt<p.issuedAt||e.kind==='practice_verified'&&e.verification.verifiedAt<p.issuedAt))reasons.push('learning_outside_window');
 if(p.issuedAt>=r.now)reasons.push('prediction_not_prior');if(r.now>=p.validUntil)reasons.push('prediction_expired');
 if(r.state.sessionId===p.sourceSessionId)reasons.push('session_reused');if(!r.state.skills.some(s=>s.skillId===p.skillId))reasons.push('skill_not_configured');
 if(r.state.deadlineAt-r.now<=30000)reasons.push('time_budget');if(r.progress.dataMode!==p.dataMode)reasons.push('data_mode_mismatch');
 if(p.dataMode==='unverified')reasons.push('unverified_data_mode');
 if(p.dataMode==='consented'&&p.sourceEvidenceMode!=='live-model')reasons.push('model_source_unverified');
 if(reasons.length)return RetestPlanSchema.parse({...base,status:'blocked',reasons});
 const asked=new Set([...p.sourceQuestionIds,...r.askedQuestionIds,...r.state.priorEvidence.map(o=>o.questionId),...r.state.observations.map(o=>o.questionId)]);
 const constructs=new Map([...r.state.priorEvidence,...r.state.observations].map(o=>[o.skillId,o.questionType==='behavioral']));
 const eligible=r.candidates.filter(c=>{
  const reason=asked.has(c.question.id)?'question_repeated':c.question.skillId!==p.skillId?'skill_mismatch':c.question.difficulty!==p.target.difficulty?'difficulty_mismatch':
   canonical(c.rubric)!==canonical(p.target.rubric)?'rubric_mismatch':constructs.has(c.question.skillId)&&constructs.get(c.question.skillId)!==(c.question.questionType==='behavioral')?'construct_mismatch':
   c.source.reviewStatus!=='reviewed'&&!(r.allowDraftKnowledge&&p.dataMode==='synthetic')?'review_required':null;
  if(reason){base.excluded.push({questionId:c.question.id,reason});return false;}return true;
 }).sort((a,b)=>a.question.id<b.question.id?-1:a.question.id>b.question.id?1:0);
 const candidate=eligible[0];return RetestPlanSchema.parse(candidate?{...base,status:'ready',candidate}:{...base,status:'unavailable',reason:'no_matching_unseen_question'});
}
