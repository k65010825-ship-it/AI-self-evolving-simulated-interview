import {z} from 'zod';
import {RoleIdSchema} from './tools.ts';
import {PlanningPolicyVersionSchema} from './policy.ts';
import {PolicyEvaluationInputSchema,PolicyEvaluationSchema} from './reflection.ts';
const id=z.string().min(1).max(100);
const policyId=PlanningPolicyVersionSchema.shape.id;
export const ExperimentIdentitySchema=z.object({experimentId:id,roleId:RoleIdSchema}).strict();
export const CreateExperimentSchema=ExperimentIdentitySchema.extend({now:z.number().int().nonnegative(),baselinePolicy:PlanningPolicyVersionSchema}).strict();
const requestBase=ExperimentIdentitySchema.extend({operationId:id,expectedVersion:z.number().int().nonnegative(),now:z.number().int().nonnegative()});
export const ExperimentOperationSchema=z.discriminatedUnion('action',[
 requestBase.extend({action:z.literal('evaluate'),evaluationInput:PolicyEvaluationInputSchema}).strict(),
 requestBase.extend({action:z.literal('rollback'),targetPolicyId:policyId,reason:z.string().trim().min(1).max(500)}).strict(),
]);
const eventBase=z.object({operationId:id,seq:z.number().int().positive(),processedAt:z.number().int().nonnegative(),
 requestDigest:z.string().regex(/^[a-f0-9]{64}$/),previousPolicyId:policyId,resultPolicyId:policyId});
export const ExperimentEventSchema=z.discriminatedUnion('action',[
 eventBase.extend({action:z.literal('evaluate'),outcome:z.enum(['activated','rejected']),evaluation:PolicyEvaluationSchema}).strict(),
 eventBase.extend({action:z.literal('rollback'),outcome:z.literal('rolled_back'),targetPolicyId:policyId,reason:z.string().min(1).max(500)}).strict(),
]);
export const ExperimentRegistrySchema=z.object({schemaVersion:z.literal(1),kind:z.literal('uncommitted-experiment-registry'),scope:z.literal('offline-experiment'),
 experimentId:id,roleId:RoleIdSchema,version:z.number().int().nonnegative(),createdAt:z.number().int().nonnegative(),updatedAt:z.number().int().nonnegative(),
 initialPolicyId:policyId,activePolicyId:policyId,policies:z.array(PlanningPolicyVersionSchema).min(1).max(51),
 operations:z.array(ExperimentEventSchema).max(50)}).strict().superRefine((r,ctx)=>{
 let invalid=r.version!==r.operations.length||r.updatedAt<r.createdAt||new Set(r.policies.map(p=>p.id)).size!==r.policies.length
  ||new Set(r.operations.map(o=>o.operationId)).size!==r.operations.length||r.policies.some(p=>p.roleId!==r.roleId);
 const policies=new Map(r.policies.map(p=>[p.id,p]));
 const known=new Set([r.initialPolicyId]),parents=new Map<string,string>();let active=r.initialPolicyId,time=r.createdAt;
 if(!policies.has(active))invalid=true;
 for(const[index,o]of r.operations.entries()){
  if(o.seq!==index+1||o.previousPolicyId!==active||o.processedAt<time||o.processedAt>r.updatedAt||!policies.has(o.resultPolicyId))invalid=true;
  if(o.action==='evaluate'){
   const e=o.evaluation;
   if(e.roleId!==r.roleId||e.baselineId!==active)invalid=true;
   const total=e.cases.length;
   const oldMatched=e.cases.filter(c=>c.baseline.action===c.expected.action&&c.baseline.skillId===c.expected.skillId).length;
   const newMatched=e.cases.filter(c=>c.candidate.action===c.expected.action&&c.candidate.skillId===c.expected.skillId).length;
   const regressions=e.cases.filter(c=>c.baselineMatched&&!c.candidateMatched).length;
   if(!total||e.baseline.total!==total||e.candidate.total!==total||e.baseline.matched!==oldMatched||e.candidate.matched!==newMatched
    ||e.baseline.value!==oldMatched/total||e.candidate.value!==newMatched/total||e.delta!==(newMatched-oldMatched)/total||e.regressions!==regressions
    ||e.groups!==new Set(e.cases.map(c=>c.groupId)).size||new Set(e.cases.map(c=>c.id)).size!==total
    ||e.cases.some(c=>c.baselineMatched!==(c.baseline.action===c.expected.action&&c.baseline.skillId===c.expected.skillId)
     ||c.candidateMatched!==(c.candidate.action===c.expected.action&&c.candidate.skillId===c.expected.skillId)))invalid=true;
   if(o.outcome==='activated'){
    const before=policies.get(active),after=policies.get(o.resultPolicyId);
    if(e.status!=='eligible_for_offline_experiment'||e.candidateId!==o.resultPolicyId||total<4||e.groups<2||e.delta<=0||e.regressions
     ||e.reasons.length||e.baseline.constraintViolations||e.candidate.constraintViolations||!before||!after
     ||after.parameters.maxFollowupDepth!==before.parameters.maxFollowupDepth-1||after.parameters.maxFollowupDepth<1
     ||after.parameters.maxTurns!==before.parameters.maxTurns||after.parameters.wrapUpSeconds!==before.parameters.wrapUpSeconds
     ||(parents.has(o.resultPolicyId)&&parents.get(o.resultPolicyId)!==active))invalid=true;
    parents.set(o.resultPolicyId,active);known.add(o.resultPolicyId);
   }else if(e.status!=='rejected'||o.resultPolicyId!==active||!e.reasons.length)invalid=true;
  }else{
   const ancestors=new Set<string>();let cursor=parents.get(active);
   while(cursor&&!ancestors.has(cursor)){ancestors.add(cursor);cursor=parents.get(cursor);}
   if(o.targetPolicyId!==o.resultPolicyId||!known.has(o.targetPolicyId)||!ancestors.has(o.targetPolicyId))invalid=true;
  }
  active=o.resultPolicyId;time=o.processedAt;
 }
 if(active!==r.activePolicyId||time!==r.updatedAt||known.size!==r.policies.length||[...known].some(k=>!policies.has(k)))invalid=true;
 if(invalid)ctx.addIssue({code:'custom',message:'Invalid experiment audit chain or policy references.'});
});
export const SessionPolicyPinInputSchema=ExperimentIdentitySchema.extend({sessionId:id,now:z.number().int().nonnegative()}).strict();
export const SessionPolicyPinSchema=z.object({kind:z.literal('offline-session-policy-pin'),experimentId:id,roleId:RoleIdSchema,
 sessionId:id,registryVersion:z.number().int().nonnegative(),pinnedAt:z.number().int().nonnegative(),policy:PlanningPolicyVersionSchema}).strict();
export type ExperimentRegistry=z.infer<typeof ExperimentRegistrySchema>;
export type SessionPolicyPin=z.infer<typeof SessionPolicyPinSchema>;
