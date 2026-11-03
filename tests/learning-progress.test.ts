import{test,expect}from'bun:test';
import{createLearningProgress,recordLearningEvent,summarizeLearning}from'../apps/agent/src/learning/progress.ts';
const identity={userId:'student-1',roleId:'java-backend',assignmentId:'assignment-1'};
const initial=()=>createLearningProgress({...identity,skillId:'primary',resourceIds:['r1'],requiredExerciseIds:['x1','x2'],dataMode:'synthetic',now:1000});
const apply=(s:unknown,event:unknown,version:number,now=2000)=>recordLearningEvent(s,{...identity,event,expectedVersion:version,now});
test('clicks and self-reported completion never count as verified completion',()=>{
 const s=initial();expect(summarizeLearning(s,identity).status).toBe('not_started');
 const click=apply(s,{id:'click',kind:'resource_clicked',occurredAt:1100,resourceId:'r1'},0);
 expect(summarizeLearning(click,identity).status).toBe('in_progress');
 const self=apply(click,{id:'self',kind:'self_reported_complete',occurredAt:1200},1);
 expect(summarizeLearning(self,identity).status).toBe('self_reported');
 expect(summarizeLearning(self,identity).verifiedCompleteAt).toBeNull();
});
test('all required exercises need distinct host-verification artifacts',()=>{
 const event={id:'v1',kind:'practice_verified',occurredAt:1300,exerciseId:'x1',verification:{artifactId:'proof1',verifierId:'host-grader',verifiedAt:1300}};
 const one=apply(initial(),event,0);expect(summarizeLearning(one,identity).status).toBe('in_progress');
 const two=apply(one,{...event,id:'v2',exerciseId:'x2',verification:{...event.verification,artifactId:'proof2',verifiedAt:1400},occurredAt:1400},1);
 expect(summarizeLearning(two,identity).status).toBe('verified_complete');expect(summarizeLearning(two,identity).verifiedCompleteAt).toBe(1400);
 expect(()=>apply(one,{...event,id:'v2',exerciseId:'x2'},1)).toThrow('VALIDATION_ERROR');
});
test('event replay is idempotent but changed events/stale writes and wrong identity fail',()=>{
 const event={id:'click',kind:'resource_clicked',occurredAt:1100,resourceId:'r1'};
 const next=apply(initial(),event,0);expect(apply(next,event,0).version).toBe(1);
 expect(()=>apply(next,{...event,occurredAt:1200},1)).toThrow('VERSION_CONFLICT');
 expect(()=>apply(next,{...event,id:'new'},0)).toThrow('VERSION_CONFLICT');
 expect(()=>recordLearningEvent(next,{...identity,userId:'other',event,expectedVersion:1,now:2000})).toThrow('FORBIDDEN');
 expect(()=>apply(initial(),{...event,occurredAt:3000},0)).toThrow('VALIDATION_ERROR');
});
test('JSON-roundtripped progress keeps its event semantics and rejects artifact or assignment forgery',()=>{
 const s=initial();expect(summarizeLearning(JSON.parse(JSON.stringify(s)),identity).status).toBe('not_started');
 expect(()=>recordLearningEvent(s,{...identity,assignmentId:'other',expectedVersion:0,now:2000,
  event:{id:'x',kind:'self_reported_complete',occurredAt:1500}})).toThrow('VERSION_CONFLICT');
 expect(()=>apply(s,{id:'v',kind:'practice_verified',occurredAt:1500,exerciseId:'unassigned',
  verification:{artifactId:'p',verifierId:'host',verifiedAt:1500}},0)).toThrow('VALIDATION_ERROR');
});
