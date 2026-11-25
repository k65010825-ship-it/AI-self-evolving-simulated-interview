import {createHash,randomUUID} from 'node:crypto';
import type {Database} from 'bun:sqlite';
import type {RoleId} from '../../../../packages/contracts/src/tools.ts';
import type {InterviewWorkflow} from '../../../../packages/contracts/src/session-workflow.ts';
import {
 LocalLearningAssignmentViewSchema,LocalLearningCreateAssignmentInputSchema,LocalLearningRecordEventInputSchema,
 LocalLearningRecordSchema,LocalLearningRetestPairInputSchema,LocalLearningRetestPlanInputSchema,
 LocalLearningRetestPlanViewSchema,LocalLearningStatusInputSchema,LocalLearningStatusSchema,
 LocalLearningVerifyPracticeInputSchema,LocalLearningXpSummarySchema,
 type LocalLearningRecord,type LocalLearningStatus,
} from '../../../../packages/contracts/src/local-learning.ts';
import type {RetestCandidate} from '../../../../packages/contracts/src/learning-planning.ts';
import type {LearningRepository} from '../learning/repository-port.ts';
import {createLearningProgress,recordLearningEvent,summarizeLearning} from '../learning/progress.ts';
import {createPrediction,pairRetest} from '../learning/retest-pair.ts';
import {planRetestQuestion} from '../learning/plan-retest.ts';
import {resolvePinnedCatalog} from '../knowledge/catalog.ts';
import {LocalRepositoryError} from '../../../../packages/local-db/src/repositories/shared.ts';
import {LocalError,type LocalProfile} from './profile-store.ts';

function fail(code:string):never{throw new LocalError(code);}
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

function unscored(w:InterviewWorkflow){
 return (w.clarificationAttempts??[]).filter((a,index,all)=>
  !w.turns.some(t=>t.input.question.id===a.input.question.id)&&!all.slice(index+1).some(next=>next.input.question.id===a.input.question.id));
}

function reportInputOf(w:InterviewWorkflow){
 const closeout=w.phase==='completed'?w.closeout:null;
 if(!closeout)return fail('VERSION_CONFLICT');
 const gaps=unscored(w);
 return{state:w.state,generatedAt:closeout.generatedAt,policyVersion:w.policy.id,skillLabels:w.skillLabels,turns:w.turns,...(gaps.length?{unscoredTurns:gaps}:{})};
}

function toRetestCandidates(roleId:RoleId,w:InterviewWorkflow):RetestCandidate[]{
 const pin=w.catalogPin??resolvePinnedCatalog(roleId,'draft-preview',w.state.skills.map(s=>s.skillId));
 return pin.items.map(item=>({
  question:{id:item.id,roleId:item.roleId,skillId:item.skillId,text:item.question,questionType:item.questionType,difficulty:item.difficulty},
  rubric:{id:item.id,version:item.version,roleId:item.roleId,scope:item.questionType==='behavioral'?'behavioral-content' as const:'technical-content' as const,
   criteria:item.rubric.map(c=>({id:c.criterionId,maxScore:c.maxScore,weight:c.weight,required:true as const,description:c.description,
    ...(c.dimension?{dimension:c.dimension}:{}),...(c.evidenceRule?{evidenceRule:c.evidenceRule}:{}),
    ...(c.anchors?{anchors:c.anchors}:{}),...(c.verificationGoal?{verificationGoal:c.verificationGoal}:{})}))},
  source:{knowledgeId:item.id,version:item.version,sourceIds:item.sourceIds,reviewStatus:item.reviewStatus},
 }));
}

function assignmentView(r:LocalLearningRecord){
 const summary=summarizeLearning(r.progress,{userId:r.progress.userId,roleId:r.roleId,assignmentId:r.assignmentId});
 return LocalLearningAssignmentViewSchema.parse({
  assignmentId:r.assignmentId,roleId:r.roleId,skillId:r.progress.skillId,version:r.version,dataMode:r.progress.dataMode,
  summary,predictionId:r.prediction.predictionId,sourceSessionId:r.prediction.sourceSessionId,sourceAnswerId:r.prediction.sourceAnswerId,
  validUntil:r.prediction.validUntil,retestPair:r.retestPair,
 });
}

export function createLocalLearningHost(o:{
 profile:LocalProfile;
 repository?:LearningRepository;
 now:()=>number;
 session:(db:Database,id:string)=>{workflow:InterviewWorkflow;deadlineAt:number};
 completedWorkflows:(db:Database,roleId:RoleId)=>InterviewWorkflow[];
 assertOperationFree:(db:Database,operationId:string)=>void;
}){
 const repo=o.repository;
 function requireRepo(){return repo??fail('LEARNING_STORAGE_UNAVAILABLE');}
 function replayOrReject(db:Database,operationId:string,digest:string){
  let prior;
  try{prior=requireRepo().findOperation(db,o.profile.profileId,operationId);}
  catch(e){if(e instanceof LocalRepositoryError&&e.code==='OPERATION_CONFLICT')return fail('VERSION_CONFLICT');throw e;}
  if(!prior)return null;
  const op=prior.operations.find(x=>x.operationId===operationId);
  if(!op||op.digest!==digest)return fail('VERSION_CONFLICT');
  return op.result;
 }
 function computeXp(db:Database,roleId:RoleId,records:LocalLearningRecord[]){
  const retestSessionIds=new Set(records.filter(r=>r.retestPair).map(r=>r.retestPair!.retestSessionId));
  const completedInterviews=o.completedWorkflows(db,roleId).filter(w=>w.turns.length>0&&!retestSessionIds.has(w.state.sessionId)).length;
  const verifiedLearnings=records.filter(r=>summarizeLearning(r.progress,{userId:o.profile.profileId,roleId,assignmentId:r.assignmentId}).status==='verified_complete').length;
  const completedRetests=retestSessionIds.size;
  const totalXp=completedInterviews*100+verifiedLearnings*30+completedRetests*100;
  return LocalLearningXpSummarySchema.parse({totalXp,level:Math.floor(totalXp/500)+1,completedInterviews,verifiedLearnings,completedRetests});
 }

 return{
  available:!!repo,
  ownsOperation:(db:Database,operationId:string)=>{
   try{return!!repo?.findOperation(db,o.profile.profileId,operationId);}
   catch(e){if(e instanceof LocalRepositoryError&&e.code==='OPERATION_CONFLICT')return false;throw e;}
  },
  skillStatus:(db:Database,roleId:RoleId,skillId:string)=>{
   if(!repo)return 'unavailable' as const;
   const records=repo.list(db,o.profile.profileId,roleId).filter(r=>r.progress.skillId===skillId)
    .sort((a,b)=>a.progress.updatedAt-b.progress.updatedAt||a.version-b.version||a.assignmentId.localeCompare(b.assignmentId));
   const latest=records.at(-1);
   if(!latest)return 'not_started' as const;
   return summarizeLearning(latest.progress,{userId:o.profile.profileId,roleId,assignmentId:latest.assignmentId}).status;
  },
  status(raw:unknown):LocalLearningStatus{
   const p=LocalLearningStatusInputSchema.safeParse(raw);
   if(!p.success)return fail('VALIDATION_ERROR');
   const input=p.data;
   if(!repo)return LocalLearningStatusSchema.parse({available:false,reason:'LEARNING_STORAGE_UNAVAILABLE',assignments:[],xp:null});
   return o.profile.read(db=>{
    const records=repo.list(db,o.profile.profileId,input.roleId).map(r=>LocalLearningRecordSchema.parse(r));
    return LocalLearningStatusSchema.parse({available:true,reason:null,assignments:records.map(assignmentView),xp:computeXp(db,input.roleId,records)});
   });
  },
  async createAssignment(raw:unknown){
   const r=requireRepo(),p=LocalLearningCreateAssignmentInputSchema.safeParse(raw);
   if(!p.success)return fail('VALIDATION_ERROR');
   const c=p.data,digest=sha({op:'createAssignment',c});
   const prep=o.profile.read(db=>{
    const replayed=replayOrReject(db,c.operationId,digest);
    if(replayed)return{replayed:LocalLearningAssignmentViewSchema.parse(replayed)};
    o.assertOperationFree(db,c.operationId);
    const {workflow:w}=o.session(db,c.sourceSessionId);
    if(w.identity.roleId!==c.roleId)return fail('ROLE_FORBIDDEN');
    const sourceReportInput=reportInputOf(w);
    const sourceTurn=w.turns.find(t=>t.input.answer.id===c.sourceAnswerId);
    if(!sourceTurn||sourceTurn.input.question.skillId!==c.skillId||sourceTurn.input.assistance)return fail('VALIDATION_ERROR');
    let targetRubric=c.targetRubric??sourceTurn.input.rubric;
    if(!c.targetRubric&&c.targetRubricId){
     const item=resolvePinnedCatalog(c.roleId,'draft-preview',[c.skillId]).items.find(i=>i.id===c.targetRubricId);
     if(!item)return fail('NOT_FOUND');
     targetRubric={id:item.id,version:item.version,roleId:item.roleId,scope:item.questionType==='behavioral'?'behavioral-content':'technical-content',
      criteria:item.rubric.map(cr=>({id:cr.criterionId,maxScore:cr.maxScore,weight:cr.weight,required:true as const,description:cr.description,
       ...(cr.dimension?{dimension:cr.dimension}:{}),...(cr.evidenceRule?{evidenceRule:cr.evidenceRule}:{}),
       ...(cr.anchors?{anchors:cr.anchors}:{}),...(cr.verificationGoal?{verificationGoal:cr.verificationGoal}:{})}))};
    }
    return{replayed:null,sourceReportInput,targetRubric,defaultDifficulty:sourceTurn.input.question.difficulty};
   });
   if(prep.replayed)return prep.replayed;
   const now=o.now(),assignmentId=randomUUID(),predictionId='pred-'+assignmentId;
   const progress=createLearningProgress({userId:o.profile.profileId,roleId:c.roleId,assignmentId,skillId:c.skillId,resourceIds:c.resourceIds,requiredExerciseIds:c.requiredExerciseIds,dataMode:c.dataMode,now});
   const prediction=await createPrediction({userId:o.profile.profileId,roleId:c.roleId,assignmentId,predictionId,progress,
    sourceReportInput:prep.sourceReportInput,sourceAnswerId:c.sourceAnswerId,issuedAt:now,validUntil:now+c.validDays*86400000,
    predictedTargetScore:c.predictedTargetScore,predictorVersion:c.predictorVersion,
    target:{difficulty:c.targetDifficulty??prep.defaultDifficulty,rubric:prep.targetRubric}});
   return o.profile.write(db=>{
    const replayed=replayOrReject(db,c.operationId,digest);
    if(replayed)return LocalLearningAssignmentViewSchema.parse(replayed);
    o.assertOperationFree(db,c.operationId);
    const view=assignmentView(LocalLearningRecordSchema.parse({assignmentId,roleId:c.roleId,version:0,progress,prediction,retestPair:null,operations:[]}));
    const next=LocalLearningRecordSchema.parse({assignmentId,roleId:c.roleId,version:0,progress,prediction,retestPair:null,
     operations:[{operationId:c.operationId,kind:'assignment_create',digest,processedAt:o.now(),result:view}]});
    r.save(db,o.profile.profileId,next,null);
    return view;
   });
  },
  recordEvent(raw:unknown){
   const r=requireRepo(),p=LocalLearningRecordEventInputSchema.safeParse(raw);
   if(!p.success)return fail('VALIDATION_ERROR');
   const c=p.data,digest=sha({op:'recordEvent',c});
   return o.profile.write(db=>{
    const replayed=replayOrReject(db,c.operationId,digest);
    if(replayed)return LocalLearningAssignmentViewSchema.parse(replayed);
    o.assertOperationFree(db,c.operationId);
    const cur=r.load(db,o.profile.profileId,c.assignmentId);
    if(!cur)return fail('NOT_FOUND');
    const parsed=LocalLearningRecordSchema.parse(cur);
    if(parsed.version!==c.expectedVersion)return fail('VERSION_CONFLICT');
    const now=o.now();
    const progress=recordLearningEvent(parsed.progress,{userId:o.profile.profileId,roleId:parsed.roleId,assignmentId:parsed.assignmentId,expectedVersion:parsed.progress.version,now,event:c.event});
    const draft=LocalLearningRecordSchema.parse({...parsed,version:parsed.version+1,progress,operations:parsed.operations});
    const view=assignmentView(draft);
    const next=LocalLearningRecordSchema.parse({...draft,operations:[...parsed.operations,{operationId:c.operationId,kind:'event_record',digest,processedAt:now,result:view}]});
    r.save(db,o.profile.profileId,next,parsed.version);
    return view;
   });
  },
  /** Host-trusted verification path only; never exposed on public renderer stdio RPC. */
  verifyPractice(raw:unknown){
   const r=requireRepo(),p=LocalLearningVerifyPracticeInputSchema.safeParse(raw);
   if(!p.success)return fail('VALIDATION_ERROR');
   const c=p.data,digest=sha({op:'verifyPractice',c});
   return o.profile.write(db=>{
    const replayed=replayOrReject(db,c.operationId,digest);
    if(replayed)return LocalLearningAssignmentViewSchema.parse(replayed);
    o.assertOperationFree(db,c.operationId);
    const cur=r.load(db,o.profile.profileId,c.assignmentId);
    if(!cur)return fail('NOT_FOUND');
    const parsed=LocalLearningRecordSchema.parse(cur);
    if(parsed.version!==c.expectedVersion)return fail('VERSION_CONFLICT');
    const now=o.now();
    const progress=recordLearningEvent(parsed.progress,{userId:o.profile.profileId,roleId:parsed.roleId,assignmentId:parsed.assignmentId,expectedVersion:parsed.progress.version,now,
     event:{id:'verify-'+c.operationId,occurredAt:c.occurredAt,kind:'practice_verified',exerciseId:c.exerciseId,
      verification:{artifactId:c.artifactId,verifierId:c.verifierId,verifiedAt:c.verifiedAt}}});
    const draft=LocalLearningRecordSchema.parse({...parsed,version:parsed.version+1,progress,operations:parsed.operations});
    const view=assignmentView(draft);
    const next=LocalLearningRecordSchema.parse({...draft,operations:[...parsed.operations,{operationId:c.operationId,kind:'practice_verify',digest,processedAt:now,result:view}]});
    r.save(db,o.profile.profileId,next,parsed.version);
    return view;
   });
  },
  planRetest(raw:unknown){
   const r=requireRepo(),p=LocalLearningRetestPlanInputSchema.safeParse(raw);
   if(!p.success)return fail('VALIDATION_ERROR');
   const input=p.data;
   return o.profile.read(db=>{
    const cur=r.load(db,o.profile.profileId,input.assignmentId);
    if(!cur)return fail('NOT_FOUND');
    const rec=LocalLearningRecordSchema.parse(cur),{workflow:w}=o.session(db,input.sessionId);
    if(w.identity.roleId!==rec.roleId)return fail('ROLE_FORBIDDEN');
    const plan=planRetestQuestion({userId:o.profile.profileId,roleId:rec.roleId,assignmentId:rec.assignmentId,prediction:rec.prediction,
     progress:rec.progress,state:w.state,now:o.now(),askedQuestionIds:w.askedQuestionIds,candidates:toRetestCandidates(rec.roleId,w),allowDraftKnowledge:w.allowDraftKnowledge});
    return LocalLearningRetestPlanViewSchema.parse({
     status:plan.status,assignmentId:plan.assignmentId,predictionId:plan.predictionId,basedOn:plan.basedOn,
     targetSkillId:rec.prediction.skillId,targetDifficulty:rec.prediction.target.difficulty,
     candidateAvailable:plan.status==='ready',
     ...(plan.status==='blocked'?{reasons:plan.reasons}:{}),
     ...(plan.status==='unavailable'?{reason:plan.reason}:{}),
    });
   });
  },
  async pairRetestSession(raw:unknown){
   const r=requireRepo(),p=LocalLearningRetestPairInputSchema.safeParse(raw);
   if(!p.success)return fail('VALIDATION_ERROR');
   const c=p.data,digest=sha({op:'pairRetest',c});
   const prep=o.profile.read(db=>{
    const replayed=replayOrReject(db,c.operationId,digest);
    if(replayed)return{replayed:LocalLearningAssignmentViewSchema.parse(replayed)};
    o.assertOperationFree(db,c.operationId);
    const cur=r.load(db,o.profile.profileId,c.assignmentId);
    if(!cur)return fail('NOT_FOUND');
    const rec=LocalLearningRecordSchema.parse(cur);
    if(rec.version!==c.expectedVersion)return fail('VERSION_CONFLICT');
    const {workflow:w}=o.session(db,c.retestSessionId);
    if(w.identity.roleId!==rec.roleId)return fail('ROLE_FORBIDDEN');
    const retestReportInput=reportInputOf(w);
    const turn=w.turns.find(t=>t.input.answer.id===c.retestAnswerId);
    if(!turn)return fail('VALIDATION_ERROR');
    const issued=w.issuedQuestions.find(q=>q.questionId===turn.input.question.id);
    const questionIssuedAt=issued?.issuedAt??w.state.startedAt;
    const answerSubmittedAt=turn.proposal.nextState.observations.at(-1)!.observedAt;
    return{replayed:null,rec,retestReportInput,questionIssuedAt,answerSubmittedAt};
   });
   if(prep.replayed)return prep.replayed;
   const now=o.now();
   const pair=await pairRetest({userId:o.profile.profileId,roleId:prep.rec.roleId,assignmentId:prep.rec.assignmentId,
    prediction:prep.rec.prediction,progress:prep.rec.progress,retestReportInput:prep.retestReportInput,
    retestAnswerId:c.retestAnswerId,questionIssuedAt:prep.questionIssuedAt,answerSubmittedAt:prep.answerSubmittedAt,
    now,dataMode:c.dataMode,...(c.reference?{reference:c.reference}:{})});
   return o.profile.write(db=>{
    const replayed=replayOrReject(db,c.operationId,digest);
    if(replayed)return LocalLearningAssignmentViewSchema.parse(replayed);
    o.assertOperationFree(db,c.operationId);
    const cur=r.load(db,o.profile.profileId,c.assignmentId);
    if(!cur)return fail('NOT_FOUND');
    const parsed=LocalLearningRecordSchema.parse(cur);
    if(parsed.version!==c.expectedVersion)return fail('VERSION_CONFLICT');
    const draft=LocalLearningRecordSchema.parse({...parsed,version:parsed.version+1,retestPair:pair,operations:parsed.operations});
    const view=assignmentView(draft);
    const next=LocalLearningRecordSchema.parse({...draft,operations:[...parsed.operations,{operationId:c.operationId,kind:'retest_pair',digest,processedAt:now,result:view}]});
    r.save(db,o.profile.profileId,next,parsed.version);
    return view;
   });
  },
 };
}
