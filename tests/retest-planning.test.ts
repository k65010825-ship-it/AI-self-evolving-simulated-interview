import { test, expect } from 'bun:test';
import { createPairFixture } from '../experiments/learning/pair-fixture.ts';
import { planRetestQuestion } from '../apps/agent/src/learning/plan-retest.ts';
async function fixture(){const f=await createPairFixture(),r=f.request;
 return{f,input:{userId:r.userId,roleId:r.roleId,assignmentId:r.assignmentId,prediction:r.prediction,progress:r.progress,
  state:r.retestReportInput.turns[0]!.input.state,now:r.questionIssuedAt,askedQuestionIds:[],allowDraftKnowledge:true,
  candidates:[{question:r.retestReportInput.turns[0]!.input.question,rubric:structuredClone(r.prediction.target.rubric),
   source:{knowledgeId:'different-q',version:'fixture-1',sourceIds:['synthetic-source'],reviewStatus:'draft'}}]}};}
test('pre-retest planning selects an unseen question with exact frozen skill difficulty and rubric',async()=>{
 const {input}=await fixture(),result=planRetestQuestion(input);
 expect(result.status).toBe('ready');if(result.status!=='ready')throw Error('Expected ready');
 expect(result.candidate.question.id).toBe('different-q');expect(result.predictionId).toBe(input.prediction.predictionId);
 expect(result.candidate.rubric).toEqual(input.prediction.target.rubric);
});
test('click-only, exposed questions and changed rubrics cannot become ready',async()=>{
 const {f,input}=await fixture();expect(planRetestQuestion({...input,progress:f.empty}).status).toBe('blocked');
 expect(planRetestQuestion({...input,askedQuestionIds:['different-q']}).status).toBe('unavailable');
 const changed=structuredClone(input);changed.candidates[0]!.rubric.criteria[0]!.weight=.5;
 expect(()=>planRetestQuestion(changed)).toThrow('VALIDATION_ERROR');
 const mismatch=structuredClone(input);mismatch.candidates[0]!.rubric.version='2';
 expect(planRetestQuestion(mismatch).status).toBe('unavailable');
 expect(()=>planRetestQuestion({...input,userId:'other'})).toThrow('FORBIDDEN');
});
test('expiry, reuse, learning chronology, mode and review gates remain pre-exposure blockers',async()=>{
 const {input}=await fixture();
 expect(planRetestQuestion({...input,now:input.prediction.validUntil}).status).toBe('blocked');
 expect(planRetestQuestion({...input,state:{...input.state,sessionId:input.prediction.sourceSessionId}}).status).toBe('blocked');
 expect(planRetestQuestion({...input,now:input.progress.updatedAt,state:{...input.state,startedAt:input.progress.updatedAt}}).status).toBe('blocked');
 expect(planRetestQuestion({...input,allowDraftKnowledge:false}).status).toBe('unavailable');
 const reviewed=structuredClone(input);reviewed.candidates[0]!.source.reviewStatus='reviewed';reviewed.allowDraftKnowledge=false;
 expect(planRetestQuestion(reviewed).status).toBe('ready');
 const consumed=structuredClone(input);consumed.state.priorEvidence=[{sessionId:'earlier',observationId:'old-o',roleId:input.roleId,
  skillId:'primary',questionId:'different-q',questionType:'technical',difficulty:2,score:.5,quality:1,observedAt:1,
  rubricId:'shared-content',rubricVersion:'1',evidenceMode:'offline-fixture'}];
 expect(planRetestQuestion(consumed).status).toBe('unavailable');
 const modes=structuredClone(input);modes.progress.dataMode='unverified';expect(planRetestQuestion(modes).status).toBe('blocked');
 expect(()=>planRetestQuestion({...input,assignmentId:'other'})).toThrow('VERSION_CONFLICT');
});
test('wrong skill/difficulty, duplicate candidate ids and foreign role cannot silently fall back',async()=>{
 const {input}=await fixture();
 const difficulty=structuredClone(input);difficulty.candidates[0]!.question.difficulty=1;expect(planRetestQuestion(difficulty).status).toBe('unavailable');
 const skill=structuredClone(input);skill.candidates[0]!.question.skillId='other';expect(planRetestQuestion(skill).status).toBe('unavailable');
 expect(()=>planRetestQuestion({...input,candidates:[input.candidates[0]!,input.candidates[0]!]})).toThrow('VALIDATION_ERROR');
 const role=structuredClone(input);role.candidates[0]!.question.roleId='web-frontend';role.candidates[0]!.rubric.roleId='web-frontend';
 expect(()=>planRetestQuestion(role)).toThrow('ROLE_FORBIDDEN');
});
test('pre-exposure plan does not mix behavioral history with technical content for the same skill',async()=>{
 const {input}=await fixture();
 const mixed=structuredClone(input);mixed.state.priorEvidence=[{sessionId:'behavioral-old',observationId:'old-behavior',roleId:input.roleId,
  skillId:'primary',questionId:'old-behavior-q',questionType:'behavioral',difficulty:2,score:.5,quality:1,observedAt:1,
  rubricId:'behavioral',rubricVersion:'1',evidenceMode:'offline-fixture'}];
 const r=planRetestQuestion(mixed);expect(r.status).toBe('unavailable');expect(r.excluded[0]?.reason).toBe('construct_mismatch');
});
