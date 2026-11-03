import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ExperimentIdentitySchema,CreateExperimentSchema,ExperimentRegistrySchema,ExperimentOperationSchema,
 SessionPolicyPinInputSchema,SessionPolicyPinSchema,type ExperimentRegistry,type SessionPolicyPin} from '../../../../packages/contracts/src/experiment.ts';
import {PlanningPolicyVersionSchema} from '../../../../packages/contracts/src/policy.ts';
import {AgentStateError} from '../planning/interview-state.ts';
import {evaluatePolicyCandidate} from './evaluate-policy.ts';
const parse=<T>(schema:z.ZodType<T>,value:unknown):T=>{const result=schema.safeParse(value);if(!result.success)throw new AgentStateError('VALIDATION_ERROR');return result.data;};
function registry(value:unknown):ExperimentRegistry{
 const parsed=parse(ExperimentRegistrySchema,value);
 if(JSON.stringify(parsed).length>4000000)throw new AgentStateError('VALIDATION_ERROR');return parsed;
}
function authorize(r:ExperimentRegistry,i:z.infer<typeof ExperimentIdentitySchema>){
 if(r.experimentId!==i.experimentId)throw new AgentStateError('FORBIDDEN');
 if(r.roleId!==i.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
}
export function createExperimentRegistry(rawInput:unknown):ExperimentRegistry{
 const input=parse(CreateExperimentSchema,rawInput);
 if(input.roleId!==input.baselinePolicy.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
 return registry({schemaVersion:1,kind:'uncommitted-experiment-registry',scope:'offline-experiment',experimentId:input.experimentId,
  roleId:input.roleId,version:0,createdAt:input.now,updatedAt:input.now,initialPolicyId:input.baselinePolicy.id,activePolicyId:input.baselinePolicy.id,
  policies:[input.baselinePolicy],operations:[]});
}
export function applyExperimentOperation(rawRegistry:unknown,rawRequest:unknown):ExperimentRegistry{
 const r=registry(rawRegistry),request=parse(ExperimentOperationSchema,rawRequest);authorize(r,request);
 const {now,expectedVersion,...business}=request;
 const requestDigest=createHash('sha256').update(JSON.stringify(business)).digest('hex');
 const prior=r.operations.find(o=>o.operationId===request.operationId);
 if(prior){
  if(now<prior.processedAt)throw new AgentStateError('VALIDATION_ERROR');
  if(prior.requestDigest!==requestDigest)throw new AgentStateError('VERSION_CONFLICT');return r;
 }
 if(now<r.updatedAt)throw new AgentStateError('VALIDATION_ERROR');
 if(expectedVersion!==r.version)throw new AgentStateError('VERSION_CONFLICT');
 const active=r.policies.find(p=>p.id===r.activePolicyId)!;
 const base={operationId:request.operationId,seq:r.version+1,processedAt:now,requestDigest,previousPolicyId:r.activePolicyId};
 if(request.action==='evaluate'){
  if(request.evaluationInput.baseline.roleId!==r.roleId||request.evaluationInput.candidate.roleId!==r.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
  if(JSON.stringify(request.evaluationInput.baseline)!==JSON.stringify(active))throw new AgentStateError('VERSION_CONFLICT');
  if(request.evaluationInput.candidate.createdAt>now)throw new AgentStateError('VALIDATION_ERROR');
  const candidate=parse(PlanningPolicyVersionSchema,{id:request.evaluationInput.candidate.id,roleId:r.roleId,parameters:request.evaluationInput.candidate.parameters});
  const known=r.policies.find(p=>p.id===candidate.id);
  if(known&&JSON.stringify(known)!==JSON.stringify(candidate))throw new AgentStateError('VERSION_CONFLICT');
  const evaluation=evaluatePolicyCandidate(request.evaluationInput),activated=evaluation.status==='eligible_for_offline_experiment';
  const previousActivation=r.operations.find(o=>o.action==='evaluate'&&o.outcome==='activated'&&o.resultPolicyId===candidate.id);
  if(activated&&previousActivation&&previousActivation.previousPolicyId!==active.id)throw new AgentStateError('VERSION_CONFLICT');
  return registry({...r,version:r.version+1,updatedAt:now,activePolicyId:activated?candidate.id:active.id,
   policies:activated&&!known?[...r.policies,candidate]:r.policies,
   operations:[...r.operations,{...base,action:'evaluate',outcome:activated?'activated':'rejected',evaluation,resultPolicyId:activated?candidate.id:active.id}]});
 }
 const parents=new Map(r.operations.filter(o=>o.action==='evaluate'&&o.outcome==='activated').map(o=>[o.resultPolicyId,o.previousPolicyId]));
 const ancestors=new Set<string>();let cursor=parents.get(active.id);
 while(cursor&&!ancestors.has(cursor)){ancestors.add(cursor);cursor=parents.get(cursor);}
 if(!ancestors.has(request.targetPolicyId))throw new AgentStateError('VERSION_CONFLICT');
 return registry({...r,version:r.version+1,updatedAt:now,activePolicyId:request.targetPolicyId,
  operations:[...r.operations,{...base,action:'rollback',outcome:'rolled_back',targetPolicyId:request.targetPolicyId,
   reason:request.reason,resultPolicyId:request.targetPolicyId}]});
}
export function pinSessionPolicy(rawRegistry:unknown,rawRequest:unknown):SessionPolicyPin{
 const r=registry(rawRegistry),request=parse(SessionPolicyPinInputSchema,rawRequest);authorize(r,request);
 if(request.now<r.updatedAt)throw new AgentStateError('VALIDATION_ERROR');
 return parse(SessionPolicyPinSchema,{kind:'offline-session-policy-pin',experimentId:r.experimentId,roleId:r.roleId,sessionId:request.sessionId,
  registryVersion:r.version,pinnedAt:request.now,policy:r.policies.find(p=>p.id===r.activePolicyId)!});
}
export function restoreExperimentRegistry(json:string,rawIdentity:unknown):ExperimentRegistry{
 const identity=parse(ExperimentIdentitySchema,rawIdentity);
 if(typeof json!=='string'||json.length>4000000)throw new AgentStateError('VALIDATION_ERROR');
 let value:unknown;try{value=JSON.parse(json);}catch{throw new AgentStateError('VALIDATION_ERROR');}
 const r=registry(value);authorize(r,identity);return r;
}
