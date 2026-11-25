import {test,expect} from 'bun:test';
import java from '../knowledge/java-backend/seed.json' with {type:'json'};
import expansion from '../knowledge/java-backend/expansion.json' with {type:'json'};
import {createKnowledgeExecutor} from '../apps/agent/src/tools/knowledge-executor.ts';
import {createInterviewState} from '../apps/agent/src/planning/interview-state.ts';
import {selectNextQuestion} from '../apps/agent/src/planning/select-question.ts';
import {resolvePinnedCatalog,catalogHistoryCompatibility} from '../apps/agent/src/knowledge/catalog.ts';
import {eligibleQuestions} from '../packages/interview-domain/src/question-eligibility.ts';
import {createPiQuestionPlanner} from '../apps/agent/src/adapters/pi/question-planner.ts';
import {createPlannerFixture} from '../experiments/pi-sdk/planner-fixture.ts';
import {createInterviewWorkflow,restoreInterviewWorkflow,planInterviewQuestion,submitInterviewAnswer,finishInterviewWorkflow} from '../apps/agent/src/orchestration/session-workflow.ts';
import {validateWorkflowTransition} from '../packages/agent-client/src/commit-validation.ts';
import {KnowledgeItemSchema} from '../packages/contracts/src/tools.ts';
import {createWorkflowFixture} from '../experiments/session/fixture.ts';
import {localJourneyExitCode} from '../scripts/accept-local-journey.ts';

test('host exclusions and nearest difficulty apply before Top-K, without model overrides',async()=>{
 const execute=createKnowledgeExecutor({userId:'u',roleId:'java-backend',runId:'r',attemptId:'a',deadlineAt:Date.now()+30000},
  {catalog:KnowledgeItemSchema.array().parse([...java,...expansion]),includeDrafts:true,excludeQuestionIds:['java-technical-visibility','java-technical-atomic-counter'],targetDifficulty:3});
 const query={roleId:'java-backend',skillId:'java-concurrency',purpose:'questioning',limit:1};
 const result=await execute('q',query);
 expect(result.data?.items.map(i=>i.id)).toEqual(['java-technical-atomic-side-effects']);
 expect((await execute('forged',{...query,excludeQuestionIds:[],targetDifficulty:1})).error?.code).toBe('VALIDATION_ERROR');
});

const skills=[{skillId:'spring-transactions',relevance:1},{skillId:'java-concurrency',relevance:.9},{skillId:'project-design',relevance:.8}];
function setup(mode:'seed'|'draft-preview'|'reviewed-only'='seed'){
 const now=Date.now(),catalogPin=resolvePinnedCatalog('java-backend',mode,skills.map(s=>s.skillId)),
  state=createInterviewState({sessionId:'fallback',roleId:'java-backend',durationMinutes:20,skills,historyCompatibility:catalogHistoryCompatibility(catalogPin)},now);
 const planningPolicy={id:'fallback-v1',roleId:'java-backend',parameters:{maxFollowupDepth:2,maxTurns:6,wrapUpSeconds:30,questionFallback:'catalog-unseen-v1'}};
 return {now,state,catalogPin,planningPolicy,askedQuestionIds:['java-scenario-transactions'],knowledge:catalogPin.items};
}
test('opt-in seed depletion switches to the next ranked skill, while full depletion alone is unavailable',()=>{
 const input=setup(),selected=selectNextQuestion(input,{allowDraftKnowledge:true});
 expect(selected).toMatchObject({status:'selected',plan:{action:'switch_skill',skillId:'java-concurrency',reason:'planned_skill_depleted_fallback'},question:{id:'java-technical-visibility'},provenance:{version:'catalog-unseen-v1',intent:{skillId:'spring-transactions'}}});
 expect(selectNextQuestion({...input,askedQuestionIds:input.catalogPin.items.map(q=>q.id),knowledge:[]},{allowDraftKnowledge:true}).status).toBe('unavailable');
 const changed=structuredClone(input);changed.catalogPin.items[0]!.question='tampered';
 expect(()=>selectNextQuestion(changed,{allowDraftKnowledge:true})).toThrow('VALIDATION_ERROR');
});
test('shared eligibility excludes all seen sources, wrong roles/skills, drafts and incompatible constructs without mutating input',()=>{
 const base=java[0]!,items=KnowledgeItemSchema.array().parse([{...base,id:'seen'},{...base,id:'prior'},{...base,id:'observed'},
  {...base,id:'behavior',questionType:'behavioral'},{...base,id:'wrong-role',roleId:'web-frontend'},
  {...base,id:'wrong-skill',skillId:'unknown'},{...base,id:'draft'},
  {...base,id:'z',difficulty:1,reviewStatus:'reviewed'},{...base,id:'a',difficulty:3,reviewStatus:'reviewed'}]);
 const before=JSON.stringify(items);
 const result=eligibleQuestions(items,{roleId:'java-backend',skillIds:['spring-transactions'],askedQuestionIds:['seen'],
  priorEvidence:[{questionId:'prior',skillId:base.skillId,questionType:'scenario'}],observations:[{questionId:'observed',skillId:base.skillId,questionType:'technical'}],allowDraftKnowledge:false,targetDifficulty:2});
 expect(result.map(q=>q.id)).toEqual(['a','z']);expect(JSON.stringify(items)).toBe(before);
});
test('pinned modes are detached, stable and generate source-exact history compatibility; reviewed-only never returns drafts',()=>{
 const pin=resolvePinnedCatalog('java-backend','draft-preview');
 expect(pin.items).toHaveLength(14);expect(catalogHistoryCompatibility(pin).allowed).toHaveLength(14);
 expect(resolvePinnedCatalog('java-backend','reviewed-only').items).toEqual([]);
 expect(resolvePinnedCatalog('java-backend','seed').items).toHaveLength(4);
 expect(resolvePinnedCatalog('java-backend','draft-preview')).toEqual(pin);
 pin.items[0]!.question='caller edit';expect(resolvePinnedCatalog('java-backend','draft-preview').items[0]!.question).not.toBe('caller edit');
});
test('real Pi uses one effective-skill session; verified full depletion opens no model session',async()=>{
 const fixture=await createPlannerFixture(),{now,knowledge,...input}=setup(),planner=createPiQuestionPlanner({cwd:process.cwd(),modelRuntime:fixture.runtime,model:fixture.model});
 const request={...input,goal:'fallback',allowDraftKnowledge:true,context:{userId:'u',roleId:'java-backend',runId:'r',attemptId:'a',deadlineAt:now+30000}};
 const result=await planner(request);
 expect(result.selection).toMatchObject({status:'selected',question:{skillId:'java-concurrency'}});
 expect(result.receipts).toHaveLength(1);expect(result.modelMessages).toBe(2);expect(fixture.stats.providerCalls).toBe(2);
 const empty=await planner({...request,askedQuestionIds:input.catalogPin.items.map(q=>q.id)});
 expect(empty).toMatchObject({selection:{status:'unavailable'},receipts:[],modelMessages:0});expect(fixture.stats.providerCalls).toBe(2);
});
test('workflow and commit gates accept grounded fallback and reject stripped provenance, forged empty results and changed pins',async()=>{
 const input=setup(),identity={userId:'u',roleId:'java-backend' as const},fixture=await createPlannerFixture();
 const create={identity,session:{sessionId:'flow',roleId:'java-backend',durationMinutes:20,skills,historyCompatibility:catalogHistoryCompatibility(input.catalogPin)},
  policy:input.planningPolicy,goal:'fallback',skillLabels:Object.fromEntries(skills.map(s=>[s.skillId,s.skillId])),allowDraftKnowledge:true,now:input.now,catalogPin:input.catalogPin};
 const initial=createInterviewWorkflow(create);
 const planner=createPiQuestionPlanner({cwd:process.cwd(),modelRuntime:fixture.runtime,model:fixture.model});
 const command={identity,expectedRevision:0,context:{...identity,runId:'r',attemptId:'a',deadlineAt:Date.now()+30000}};
 const after=await planInterviewQuestion(initial,command,{plan:planner});
 expect(await restoreInterviewWorkflow(JSON.stringify(after),identity)).toEqual(after);
 validateWorkflowTransition({action:'plan',snapshot:initial,command},after,Date.now());
 const changed=structuredClone(after);delete changed.current!.provenance;delete changed.lastPlan!.selection.provenance;
 expect(()=>validateWorkflowTransition({action:'plan',snapshot:initial,command},changed,Date.now())).toThrow('COMMIT_TRANSITION_INVALID');
 await expect(planInterviewQuestion(initial,command,{plan:async()=>({kind:'uncommitted-knowledge-plan',selection:{status:'unavailable',plan:{action:'switch_skill',skillId:'spring-transactions',difficulty:2,remainingSeconds:1200,reason:'fake'},reason:'no_eligible_question'},receipts:[],modelMessages:0})})).rejects.toThrow();
});
test('grounded fallback reaches closeout without false plan mismatch and restores the exact frozen reflection',async()=>{
 const input=setup(),identity={userId:'u',roleId:'java-backend' as const},deps=await createWorkflowFixture();
 let workflow=createInterviewWorkflow({identity,session:{sessionId:'reflect-fallback',roleId:identity.roleId,durationMinutes:20,
  skills:skills.map((s,i)=>({...s,relevance:i===0?1:.1})),historyCompatibility:catalogHistoryCompatibility(input.catalogPin)},
  policy:input.planningPolicy,goal:'reflection',skillLabels:Object.fromEntries(skills.map(s=>[s.skillId,s.skillId])),allowDraftKnowledge:true,now:input.now,catalogPin:input.catalogPin});
 const context=(runId:string)=>({...identity,runId,attemptId:'a',deadlineAt:Date.now()+30000});
 for(let i=0;i<2;i++){
  const before=workflow,command={identity,expectedRevision:workflow.revision,context:context('plan'+i)};
  workflow=await planInterviewQuestion(workflow,command,deps);
  validateWorkflowTransition({action:'plan',snapshot:before,command},workflow,Date.now());
  if(i===1)expect(workflow.current?.plan.reason).toBe('planned_skill_depleted_fallback');
  workflow=await submitInterviewAnswer(workflow,{identity,expectedRevision:workflow.revision,context:context('answer'+i),observationId:'o'+i,
   answer:{id:'a'+i,text:'我会先明确边界，再验证失败恢复和并发行为。'},quality:1,evidenceMode:'offline-fixture'},deps);
 }
 const closed=await finishInterviewWorkflow(workflow,{identity,expectedRevision:workflow.revision,mode:'user_stop',sourceGroupId:'g'});
 expect(closed.closeout!.reflection.planning).toMatchObject({fallbackCount:1,issuedCount:2});
 expect(closed.closeout!.reflection.findings.some(f=>f.code==='plan_mismatch')).toBe(false);
 expect(closed.closeout!.reflection.metrics.planAdherence).toEqual({numerator:1,denominator:1,value:1});
 expect(JSON.stringify(await restoreInterviewWorkflow(JSON.stringify(closed),identity))).toBe(JSON.stringify(closed));
});
test('journey exit status requires both mechanism and experience success',()=>{
 expect(localJourneyExitCode({mechanismStatus:'passed',experienceStatus:'passed'})).toBe(0);
 expect(localJourneyExitCode({mechanismStatus:'failed',experienceStatus:'passed'})).toBe(1);
 expect(localJourneyExitCode({mechanismStatus:'passed',experienceStatus:'needs-improvement'})).toBe(2);
 expect(localJourneyExitCode({mechanismStatus:'passed',experienceStatus:'not-evaluated'})).toBe(2);
});

test('legacy selection remains unavailable when its planned seed skill is depleted',()=>{
 const now=Date.now(),state=createInterviewState({sessionId:'legacy',roleId:'java-backend',durationMinutes:20,
  skills:[{skillId:'spring-transactions',relevance:1},{skillId:'java-concurrency',relevance:.9}]},now);
 const selection=selectNextQuestion({state,now,knowledge:java,askedQuestionIds:['java-scenario-transactions']},{allowDraftKnowledge:true});
 expect(selection).toEqual({status:'unavailable',plan:{action:'switch_skill',skillId:'spring-transactions',difficulty:2,remainingSeconds:1200,reason:'priority_from_cumulative_state'},reason:'no_eligible_question'});
});
