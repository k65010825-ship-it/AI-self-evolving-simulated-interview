import{z}from'zod';
import{LearningIdentitySchema,CreateLearningSchema,LearningProgressSchema,RecordLearningEventSchema,LearningSummarySchema,
 type LearningProgress,type LearningSummary}from'../../../../packages/contracts/src/learning.ts';
import{AgentStateError}from'../planning/interview-state.ts';
export function parseLearning<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new AgentStateError('VALIDATION_ERROR');return result.data;}
export function authorizeLearning(snapshot:z.infer<typeof LearningIdentitySchema>,identity:z.infer<typeof LearningIdentitySchema>){
 if(snapshot.userId!==identity.userId)throw new AgentStateError('FORBIDDEN');
 if(snapshot.roleId!==identity.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
 if(snapshot.assignmentId!==identity.assignmentId)throw new AgentStateError('VERSION_CONFLICT');
}
export function createLearningProgress(rawInput:unknown):LearningProgress{
 const{now,...input}=parseLearning(CreateLearningSchema,rawInput);
 return parseLearning(LearningProgressSchema,{...input,schemaVersion:1,kind:'uncommitted-learning-progress',version:0,createdAt:now,updatedAt:now,events:[]});
}
export function recordLearningEvent(rawSnapshot:unknown,rawRequest:unknown):LearningProgress{
 const snapshot=parseLearning(LearningProgressSchema,rawSnapshot),request=parseLearning(RecordLearningEventSchema,rawRequest);authorizeLearning(snapshot,request);
 const existing=snapshot.events.find(e=>e.event.id===request.event.id);
 if(existing){if(request.now<existing.acceptedAt)throw new AgentStateError('VALIDATION_ERROR');
  if(JSON.stringify(existing.event)!==JSON.stringify(request.event))throw new AgentStateError('VERSION_CONFLICT');return snapshot;}
 if(request.expectedVersion!==snapshot.version)throw new AgentStateError('VERSION_CONFLICT');
 if(request.now<snapshot.updatedAt)throw new AgentStateError('VALIDATION_ERROR');
 return parseLearning(LearningProgressSchema,{...snapshot,version:snapshot.version+1,updatedAt:request.now,
  events:[...snapshot.events,{event:request.event,acceptedAt:request.now}]});
}
export function summarizeLearning(rawSnapshot:unknown,rawIdentity:unknown):LearningSummary{
 const snapshot=parseLearning(LearningProgressSchema,rawSnapshot),identity=parseLearning(LearningIdentitySchema,rawIdentity);authorizeLearning(snapshot,identity);
 const verified=new Map<string,number>();for(const{event}of snapshot.events)if(event.kind==='practice_verified'){
  const current=verified.get(event.exerciseId);if(current===undefined||event.verification.verifiedAt<current)verified.set(event.exerciseId,event.verification.verifiedAt);}
 const complete=snapshot.requiredExerciseIds.every(id=>verified.has(id));
 return LearningSummarySchema.parse({status:complete?'verified_complete':snapshot.events.some(e=>e.event.kind==='self_reported_complete')?'self_reported':snapshot.events.length?'in_progress':'not_started',
  verifiedExerciseIds:[...verified.keys()],requiredExercises:snapshot.requiredExerciseIds.length,
  verifiedCompleteAt:complete?Math.max(...snapshot.requiredExerciseIds.map(id=>verified.get(id)!)):null});
}
