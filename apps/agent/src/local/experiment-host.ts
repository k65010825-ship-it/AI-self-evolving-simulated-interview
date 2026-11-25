import {createHash,randomUUID} from 'node:crypto';
import type {Database} from 'bun:sqlite';
import type {InterviewWorkflow} from '../../../../packages/contracts/src/session-workflow.ts';
import {
 LocalExperimentActionResultSchema,LocalExperimentEvaluateInputSchema,LocalExperimentRecordSchema,
 LocalExperimentRollbackInputSchema,LocalExperimentStatusInputSchema,LocalExperimentStatusSchema,
 type LocalExperimentActionResult,type LocalExperimentStatus,
} from '../../../../packages/contracts/src/local-experiment.ts';
import type {ExperimentRepository} from '../reflection/repository-port.ts';
import {createExperimentRegistry,applyExperimentOperation} from '../reflection/experiment-registry.ts';
import {evaluateWorkflowRsi} from '../reflection/evaluate-workflow-rsi.ts';
import {LocalRepositoryError} from '../../../../packages/local-db/src/repositories/shared.ts';
import {LocalError,type LocalProfile} from './profile-store.ts';

function fail(code:string):never{throw new LocalError(code);}
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

export function createLocalExperimentHost(o:{
 profile:LocalProfile;
 repository?:ExperimentRepository;
 now:()=>number;
 session:(db:Database,id:string)=>{workflow:InterviewWorkflow;deadlineAt:number};
 assertOperationFree:(db:Database,operationId:string)=>void;
}){
 const repo=o.repository;
 function requireRepo(){return repo??fail('EXPERIMENT_STORAGE_UNAVAILABLE');}
 if(repo)o.profile.write(db=>{
  for(const raw of repo.pending(db,o.profile.profileId)){
   const rec=LocalExperimentRecordSchema.parse(raw);
   const hasPending=rec.runs.some(r=>r.status==='queued'||r.status==='running');
   if(!hasPending)continue;
   const next=LocalExperimentRecordSchema.parse({...rec,version:rec.version+1,
    runs:rec.runs.map(r=>r.status==='queued'||r.status==='running'?{...r,status:'interrupted' as const,errorCode:'INTERRUPTED',finishedAt:o.now()}:r)});
   repo.save(db,o.profile.profileId,next,rec.version);
  }
 });

 function replayOrReject(db:Database,operationId:string,digest:string){
  let prior;
  try{prior=requireRepo().findOperation(db,o.profile.profileId,operationId);}
  catch(e){if(e instanceof LocalRepositoryError&&e.code==='OPERATION_CONFLICT')return fail('VERSION_CONFLICT');throw e;}
  if(!prior)return null;
  const op=prior.operations.find(x=>x.operationId===operationId);
  if(!op||op.digest!==digest)return fail('VERSION_CONFLICT');
  return LocalExperimentActionResultSchema.parse(op.result);
 }

 return{
  available:!!repo,
  ownsOperation:(db:Database,operationId:string)=>{
   try{return!!repo?.findOperation(db,o.profile.profileId,operationId);}
   catch(e){if(e instanceof LocalRepositoryError&&e.code==='OPERATION_CONFLICT')return false;throw e;}
  },
  status(raw:unknown):LocalExperimentStatus{
   const p=LocalExperimentStatusInputSchema.safeParse(raw);
   if(!p.success)return fail('VALIDATION_ERROR');
   const input=p.data;
   if(!repo)return LocalExperimentStatusSchema.parse({available:false,reason:'EXPERIMENT_STORAGE_UNAVAILABLE',deploymentStatus:'not_published',experiments:[]});
   return o.profile.read(db=>{
    const records=repo.list(db,o.profile.profileId,input.roleId).map(r=>LocalExperimentRecordSchema.parse(r));
    return LocalExperimentStatusSchema.parse({available:true,reason:null,deploymentStatus:'not_published',
     experiments:records.map(r=>({experimentId:r.experimentId,roleId:r.roleId,version:r.version,registryVersion:r.registry.version,
      activePolicyId:r.registry.activePolicyId,initialPolicyId:r.registry.initialPolicyId,deploymentStatus:'not_published' as const,runs:r.runs}))});
   });
  },
  async evaluate(raw:unknown):Promise<LocalExperimentActionResult>{
   const r=requireRepo(),p=LocalExperimentEvaluateInputSchema.safeParse(raw);
   if(!p.success)return fail('VALIDATION_ERROR');
   const c=p.data,digest=sha({op:'evaluate',c});
   const prep=o.profile.read(db=>{
    const replayed=replayOrReject(db,c.operationId,digest);
    if(replayed)return{replayed};
    o.assertOperationFree(db,c.operationId);
    const {workflow:w}=o.session(db,c.sourceSessionId);
    if(w.identity.roleId!==c.roleId)return fail('ROLE_FORBIDDEN');
    const closeout=w.phase==='completed'?w.closeout:null;
    if(!closeout)return fail('VERSION_CONFLICT');
    const existing=r.load(db,o.profile.profileId,c.experimentId);
    const rec=existing?LocalExperimentRecordSchema.parse(existing):null;
    if(rec&&rec.roleId!==c.roleId)return fail('ROLE_FORBIDDEN');
    const registry=rec?.registry??createExperimentRegistry({experimentId:c.experimentId,roleId:c.roleId,baselinePolicy:w.policy,now:Math.min(o.now(),closeout.generatedAt)});
    const expectedRegistryVersion=c.expectedRegistryVersion??registry.version;
    if(expectedRegistryVersion!==registry.version)return fail('VERSION_CONFLICT');
    return{replayed:null,workflow:w,registry,expectedRegistryVersion,expectedRecordVersion:rec?.version??null};
   });
   if(prep.replayed)return prep.replayed;
   const at=o.now();
   const rsi=await evaluateWorkflowRsi({
    identity:{userId:o.profile.profileId,roleId:c.roleId},snapshot:prep.workflow,experimentId:c.experimentId,
    registry:prep.registry,expectedRegistryVersion:prep.expectedRegistryVersion,operationId:c.operationId,
    ...(c.suite?{suite:c.suite}:{}),developmentGroupIds:c.developmentGroupIds,developmentSessionIds:c.developmentSessionIds,
    nextSessionId:c.nextSessionId,now:at,
   },{now:o.now});
   const actionResult=LocalExperimentActionResultSchema.parse({
    experimentId:c.experimentId,roleId:c.roleId,scope:'offline-experiment',productionPublished:false,deploymentStatus:'not_published',
    status:rsi.status,activePolicyId:rsi.activeAfter,registryVersion:rsi.registryCandidate.version,outcome:rsi.recordedOutcome??'skipped_no_candidate',
    evaluation:rsi.evaluation?{baselineMatched:rsi.evaluation.baseline.matched,candidateMatched:rsi.evaluation.candidate.matched,
     total:rsi.evaluation.baseline.total,delta:rsi.evaluation.delta,regressions:rsi.evaluation.regressions}:null,
    reasons:rsi.reasons,
   });
   return o.profile.write(db=>{
    const replayed=replayOrReject(db,c.operationId,digest);
    if(replayed)return replayed;
    o.assertOperationFree(db,c.operationId);
    const cur=r.load(db,o.profile.profileId,c.experimentId),parsed=cur?LocalExperimentRecordSchema.parse(cur):null;
    if((parsed?.version??null)!==prep.expectedRecordVersion)return fail('VERSION_CONFLICT');
    const runRecord={jobId:randomUUID(),operationId:c.operationId,action:'evaluate' as const,sourceSessionId:c.sourceSessionId,
     status:'completed' as const,outcome:actionResult.outcome,errorCode:null,createdAt:at,finishedAt:o.now()};
    const next=LocalExperimentRecordSchema.parse({
     experimentId:c.experimentId,roleId:c.roleId,version:(parsed?.version??-1)+1,registry:rsi.registryCandidate,
     runs:[...(parsed?.runs??[]),runRecord],
     operations:[...(parsed?.operations??[]),{operationId:c.operationId,action:'evaluate',digest,processedAt:o.now(),result:actionResult}],
    });
    r.save(db,o.profile.profileId,next,parsed?.version??null);
    return actionResult;
   });
  },
  rollback(raw:unknown):LocalExperimentActionResult{
   const r=requireRepo(),p=LocalExperimentRollbackInputSchema.safeParse(raw);
   if(!p.success)return fail('VALIDATION_ERROR');
   const c=p.data,digest=sha({op:'rollback',c});
   return o.profile.write(db=>{
    const replayed=replayOrReject(db,c.operationId,digest);
    if(replayed)return replayed;
    o.assertOperationFree(db,c.operationId);
    const cur=r.load(db,o.profile.profileId,c.experimentId);
    if(!cur)return fail('NOT_FOUND');
    const parsed=LocalExperimentRecordSchema.parse(cur);
    if(parsed.roleId!==c.roleId)return fail('ROLE_FORBIDDEN');
    const at=o.now();
    const nextRegistry=applyExperimentOperation(parsed.registry,{experimentId:c.experimentId,roleId:c.roleId,
     operationId:c.operationId,expectedVersion:c.expectedRegistryVersion,now:at,action:'rollback',targetPolicyId:c.targetPolicyId,reason:c.reason});
    const actionResult=LocalExperimentActionResultSchema.parse({
     experimentId:c.experimentId,roleId:c.roleId,scope:'offline-experiment',productionPublished:false,deploymentStatus:'not_published',
     status:'rolled_back',activePolicyId:nextRegistry.activePolicyId,registryVersion:nextRegistry.version,
     outcome:'rolled_back',evaluation:null,reasons:[c.reason],
    });
    const runRecord={jobId:randomUUID(),operationId:c.operationId,action:'rollback' as const,sourceSessionId:null,
     status:'completed' as const,outcome:'rolled_back' as const,errorCode:null,createdAt:at,finishedAt:at};
    const next=LocalExperimentRecordSchema.parse({...parsed,version:parsed.version+1,registry:nextRegistry,
     runs:[...parsed.runs,runRecord],
     operations:[...parsed.operations,{operationId:c.operationId,action:'rollback',digest,processedAt:at,result:actionResult}]});
    r.save(db,o.profile.profileId,next,parsed.version);
    return actionResult;
   });
  },
 };
}
