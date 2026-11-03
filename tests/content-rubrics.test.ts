import{test,expect}from'bun:test';
import java from'../knowledge/java-backend/seed.json'with{type:'json'};
import web from'../knowledge/web-frontend/seed.json'with{type:'json'};
import{createInterviewState}from'../apps/agent/src/planning/interview-state.ts';
import{recordObservation,estimateSkills}from'../apps/agent/src/planning/interview-state.ts';
import{MemorySnapshotSchema}from'../packages/contracts/src/memory.ts';
import{selectNextQuestion}from'../apps/agent/src/planning/select-question.ts';
import{RubricSchema}from'../packages/contracts/src/scoring.ts';
import{evaluateTurn}from'../apps/agent/src/orchestration/evaluate-turn.ts';
import{runContentRubricsDemo}from'../scripts/demo-content-rubrics.ts';
import{buildInterviewReport}from'../apps/agent/src/reporting/build-report.ts';
for(const[roleId,knowledge]of[['java-backend',java],['web-frontend',web]]as const){
 for(const kind of ['project','behavioral']as const){
  test(`${roleId} selects ${kind} with differentiated evidence-anchored dimensions`,()=>{
   const now=Date.now(),skillId=kind==='project'?'project-design':'collaboration';
   const state=createInterviewState({sessionId:'multidimension',roleId,durationMinutes:20,skills:[{skillId,relevance:1}]},now);
   const result=selectNextQuestion({state,now,knowledge,askedQuestionIds:[]},{allowDraftKnowledge:true});
   expect(result.status).toBe('selected');if(result.status!=='selected')throw new Error('Question missing');
   expect(result.rubric.scope).toBe(kind==='behavioral'?'behavioral-content':'technical-content');
   expect(result.rubric.criteria).toHaveLength(4);
   expect(result.rubric.criteria.some(c=>c.dimension==='logic')).toBe(true);
   for(const c of result.rubric.criteria){expect(c.anchors?.map(a=>a.score)).toEqual([0,1,2,3,4]);expect(c.evidenceRule?.length).toBeGreaterThan(10);}
   expect(JSON.stringify(result.question)).not.toContain('anchors');
  });
 }
}

test('anchors reject duplicates, disorder, missing endpoints and over-max values',()=>{
 const base={id:'r',version:'1',roleId:'java-backend',scope:'behavioral-content',criteria:[{id:'logic',required:true,maxScore:4,weight:1}]};
 for(const scores of [[1,4],[0,3],[0,4,2],[0,2,2,4],[0,5,4]]){
  expect(RubricSchema.safeParse({...base,criteria:[{...base.criteria[0],anchors:scores.map(score=>({score,description:'锚点'}))}]}).success).toBe(false);
 }
});

test('both roles traverse project and behavioral SDK evaluation with independently checked weighted math',async()=>{
 for(const role of ['java-backend','web-frontend']as const){
  const d=await runContentRubricsDemo(role);expect(d.questionTypes).toEqual(['project','behavioral']);expect(d.scope).toBe('mixed-content');
  expect(d.scopes).toEqual(['technical-content','behavioral-content']);expect(d.scores[0]).toBeCloseTo(.7,10);
  expect(d.scores[1]).toBeCloseTo(role==='java-backend'?.6625:.6375,10);
  expect(d.anchorsInPrompt).toBe(8);expect(d.liveModelCalls).toBe(0);expect(d.providerCalls).toBe(2);
  expect(d.report.warnings).toContain('behavioral_narrative_not_verified_experience');
 }
 expect(java[3]!.rubric.map(c=>c.criterionId)).not.toEqual(web[3]!.rubric.map(c=>c.criterionId));
});

test('scope mismatch fails before evaluator and historical same-skill construct mixing is rejected',async()=>{
 const now=Date.now(),state=createInterviewState({sessionId:'scope',roleId:'java-backend',durationMinutes:20,skills:[{skillId:'collaboration',relevance:1}]},now);
 const q=selectNextQuestion({state,now,knowledge:java,askedQuestionIds:[]},{allowDraftKnowledge:true});if(q.status!=='selected')throw new Error('Expected behavior');
 const input={state,expectedVersion:0,observationId:'o',goal:'范围测试',context:{userId:'u',roleId:'java-backend',runId:'r',attemptId:'a',deadlineAt:now+60000},
  question:q.question,answer:{id:'a',text:'假设案例中的协作行动'},quality:1,rubric:{...q.rubric,scope:'technical-content'},knowledge:[]};
 let calls=0;await expect(evaluateTurn(input,{evaluate:async()=>{calls++;return {};}})).rejects.toThrow('VALIDATION_ERROR');expect(calls).toBe(0);
});

test('prior-only behavioral report keeps its scope and contaminated history cannot enter estimates or memory',async()=>{
 const now=Date.now(),base=createInterviewState({sessionId:'new',roleId:'java-backend',durationMinutes:20,skills:[{skillId:'collaboration',relevance:1}]},now);
 const observation={observationId:'old-o',roleId:'java-backend',skillId:'collaboration',questionId:'old-q',questionType:'behavioral',difficulty:2,
  score:.8,quality:1,observedAt:now-100,sessionId:'old',rubricId:'r',rubricVersion:'1',evidenceMode:'offline-fixture'};
 const state={...base,priorEvidence:[observation]};
 const report=await buildInterviewReport({state,generatedAt:now,policyVersion:'1',skillLabels:{collaboration:'协作叙述'},turns:[]});
 expect(report.scope).toBe('behavioral-content');expect(report.warnings).toContain('behavioral_narrative_not_verified_experience');
 const mixed={...state,priorEvidence:[observation,{...observation,observationId:'other',questionId:'other-q',questionType:'technical'}]};
 expect(()=>estimateSkills(mixed,now)).toThrow('VALIDATION_ERROR');
 expect(MemorySnapshotSchema.safeParse({schemaVersion:1,kind:'uncommitted-memory-snapshot',userId:'u',roleId:'java-backend',version:1,updatedAt:now,
  sessions:[{sessionId:'old',stateVersion:2,endedAt:now-1,acceptedAt:now,policyVersion:'1',evidenceMode:'offline-fixture',observations:mixed.priorEvidence}]}).success).toBe(false);
});

test('selection does not offer a conflicting behavioral construct for an established technical skill',()=>{
 const now=Date.now(),base=createInterviewState({sessionId:'selection-scope',roleId:'java-backend',durationMinutes:20,skills:[{skillId:'collaboration',relevance:1}]},now);
 const state=recordObservation(base,{observationId:'o',roleId:'java-backend',skillId:'collaboration',questionId:'tech',questionType:'technical',difficulty:2,score:.5,quality:1,observedAt:now},0,now);
 expect(selectNextQuestion({state,now,knowledge:java,askedQuestionIds:[]},{allowDraftKnowledge:true}).status).toBe('unavailable');
 expect(()=>recordObservation(state,{observationId:'o2',roleId:'java-backend',skillId:'collaboration',questionId:'behavior',questionType:'behavioral',difficulty:2,score:.5,quality:1,observedAt:now},1,now)).toThrow('VALIDATION_ERROR');
});

test('report replays scope; missing required dimensions or invented excerpts fail without a numeric proposal',async()=>{
 const d=await runContentRubricsDemo(),changed=structuredClone(d.reportInput);changed.turns[1]!.input.rubric.scope='technical-content';
 await expect(buildInterviewReport(changed)).rejects.toThrow('VALIDATION_ERROR');
 const input=d.reportInput.turns[1]!.input;
 for(const wrongEvidence of [false,true]){
  await expect(evaluateTurn(input,{evaluate:async()=>({evidence:[{id:'e',start:0,end:4,excerpt:wrongEvidence?'虚构引用':input.answer.text.slice(0,4)}],
   criterionScores:input.rubric.criteria.map((c,i)=>({criterionId:c.id,score:!wrongEvidence&&i===0?null:2,evidenceIds:['e']})),
   feedback:{strengths:[],improvements:['需要证据']}})})).rejects.toThrow('MODEL_OUTPUT_INVALID');
 }
});
