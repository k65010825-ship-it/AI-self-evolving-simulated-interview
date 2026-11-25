import {test,expect} from 'bun:test';
import {createInterviewWorkflow,planInterviewQuestion,restoreInterviewWorkflow,finishInterviewWorkflow} from '../apps/agent/src/orchestration/session-workflow.ts';
import {resolvePinnedCatalog,catalogHistoryCompatibility} from '../apps/agent/src/knowledge/catalog.ts';
import {createWorkflowFixture} from '../experiments/session/fixture.ts';
import {validateWorkflowTransition} from '../packages/agent-client/src/commit-validation.ts';
import {selectNextQuestion} from '../apps/agent/src/planning/select-question.ts';
import {reflectSession} from '../apps/agent/src/reflection/reflect-session.ts';
function setup(){
 const now=Date.now(),identity={userId:'u',roleId:'java-backend' as const},skills=[{skillId:'spring-transactions',relevance:1},{skillId:'java-concurrency',relevance:.9}];
 const catalogPin=resolvePinnedCatalog(identity.roleId,'seed',skills.map(s=>s.skillId));
 const initial=createInterviewWorkflow({identity,catalogPin,session:{sessionId:'integrity',roleId:identity.roleId,durationMinutes:20,skills,historyCompatibility:catalogHistoryCompatibility(catalogPin)},
  policy:{id:'p0',roleId:identity.roleId,parameters:{maxFollowupDepth:1,maxTurns:6,wrapUpSeconds:30,questionFallback:'catalog-unseen-v1'}},
  goal:'integrity',skillLabels:{'spring-transactions':'Spring','java-concurrency':'Java'},allowDraftKnowledge:true,now});
 const command={identity,expectedRevision:0,context:{...identity,runId:'p',attemptId:'a',deadlineAt:now+30000}};
 return{initial,catalogPin,identity,command,now};
}
test('commit rejects a fabricated early finished plan even with catalog provenance',()=>{
 const f=setup(),selection=selectNextQuestion({state:f.initial.state,now:f.now,knowledge:f.catalogPin.items,catalogPin:f.catalogPin,planningPolicy:f.initial.policy,askedQuestionIds:[]},{allowDraftKnowledge:true});
 const after={...f.initial,revision:1,phase:'ready_to_close' as const,pendingReason:'plan_finished' as const,
  lastPlan:{kind:'uncommitted-knowledge-plan' as const,selection:{status:'finished' as const,plan:{...selection.plan,action:'finish' as const,skillId:null,reason:'turn_budget'},provenance:selection.provenance},receipts:[],modelMessages:0}};
 expect(()=>validateWorkflowTransition({action:'plan',snapshot:f.initial,command:f.command},after,f.now)).toThrow('COMMIT_TRANSITION_INVALID');
});
test('restore refuses an ungrounded knowledge_gap while the entire pinned catalog is still unseen',async()=>{
 const f=setup(),after={...f.initial,revision:1,phase:'ready_to_close',pendingReason:'knowledge_gap'};
 await expect(restoreInterviewWorkflow(JSON.stringify(after),f.identity)).rejects.toThrow('VALIDATION_ERROR');
});
test('workflow and commit reject additional out-of-scope receipt items alongside a correct selected question',async()=>{
 const f=setup(),deps=await createWorkflowFixture();
 const valid=await planInterviewQuestion(f.initial,f.command,deps),changed=structuredClone(valid);
 changed.lastPlan!.receipts[0]!.data!.items.push(f.catalogPin.items.find(q=>q.skillId==='java-concurrency')!);
 expect(()=>validateWorkflowTransition({action:'plan',snapshot:f.initial,command:f.command},changed,Date.now())).toThrow('COMMIT_TRANSITION_INVALID');
 await expect(planInterviewQuestion(f.initial,f.command,{plan:async()=>changed.lastPlan!})).rejects.toThrow('MODEL_OUTPUT_INVALID');
});
test('reflection cannot count execution records with no authoritative issued questions or answers',async()=>{
 const f=setup(),selection=selectNextQuestion({state:f.initial.state,now:f.now,knowledge:f.catalogPin.items,catalogPin:f.catalogPin,planningPolicy:f.initial.policy,askedQuestionIds:[]},{allowDraftKnowledge:true});
 await expect(reflectSession({reportInput:{state:f.initial.state,generatedAt:f.now,policyVersion:f.initial.policy.id,skillLabels:f.initial.skillLabels,turns:[]},baselinePolicy:f.initial.policy,generatedAt:f.now,
  sourceGroupId:'g',catalogPin:f.catalogPin,allowDraftKnowledge:true,executedPlans:[{questionId:'never-issued',issuedAt:f.now,plan:selection.plan,provenance:selection.provenance}]})).rejects.toThrow('VALIDATION_ERROR');
});
test('finish commit rejects dropped or inflated reflection planning counts',async()=>{
 const f=setup(),command={identity:f.identity,expectedRevision:0,mode:'user_stop' as const,sourceGroupId:'g'},closed=await finishInterviewWorkflow(f.initial,command);
 validateWorkflowTransition({action:'finish',snapshot:f.initial,command},closed,Date.now());
 for(const mode of ['drop','inflate']){
  const changed=structuredClone(closed);
  if(mode==='drop')delete changed.closeout!.reflection.planning;
  else changed.closeout!.reflection.planning!.issuedCount=1;
  expect(()=>validateWorkflowTransition({action:'finish',snapshot:f.initial,command},changed,Date.now())).toThrow('COMMIT_TRANSITION_INVALID');
 }
});
test('commit recomputes skill ranking rather than trusting a fabricated matching intent',async()=>{
 const f=setup(),deps=await createWorkflowFixture(),after=await planInterviewQuestion(f.initial,f.command,deps),at=after.currentIssuedAt!;
 const wrong=selectNextQuestion({state:{...f.initial.state,skills:f.initial.state.skills.map(s=>({...s,relevance:s.skillId==='java-concurrency'?1:.1}))},
  now:at,knowledge:f.catalogPin.items,catalogPin:f.catalogPin,planningPolicy:f.initial.policy,askedQuestionIds:[]},{allowDraftKnowledge:true});
 if(wrong.status!=='selected')throw Error('selected');
 after.current=wrong;after.lastPlan!.selection=wrong;
 const item=f.catalogPin.items.find(q=>q.id===wrong.question.id)!;
 after.lastPlan!.receipts[0]!.data!.items=[item];after.lastPlan!.receipts[0]!.sourceIds=item.sourceIds;
 after.askedQuestionIds=[item.id];after.issuedQuestions=[{questionId:item.id,issuedAt:at,content:{question:wrong.question,rubric:wrong.rubric,source:wrong.source,text:wrong.question.text,
  stateVersion:0,policyId:f.initial.policy.id,planRunId:f.command.context.runId,planAttemptId:'a',effectivePlan:{plan:wrong.plan,provenance:wrong.provenance!}}}];
 expect(()=>validateWorkflowTransition({action:'plan',snapshot:f.initial,command:f.command},after,Date.now())).toThrow('COMMIT_TRANSITION_INVALID');
});
test('pinned workflow/restore/commit refuse forged sources, duplicate calls and out-of-catalog retrievals',async()=>{
 const f=setup(),deps=await createWorkflowFixture(),valid=await planInterviewQuestion(f.initial,f.command,deps);
 for(const mode of ['sources','duplicate','catalog']){
  const changed=structuredClone(valid),r=changed.lastPlan!.receipts[0]!;
  if(mode==='sources')r.sourceIds=['forged'];
  if(mode==='duplicate')changed.lastPlan!.receipts.push(structuredClone(r));
  if(mode==='catalog')r.data!.items.push({...r.data!.items[0]!,id:'outside-catalog'});
  expect(()=>validateWorkflowTransition({action:'plan',snapshot:f.initial,command:f.command},changed,Date.now())).toThrow('COMMIT_TRANSITION_INVALID');
  await expect(restoreInterviewWorkflow(JSON.stringify(changed),f.identity)).rejects.toThrow('VALIDATION_ERROR');
  await expect(planInterviewQuestion(f.initial,f.command,{plan:async()=>changed.lastPlan!})).rejects.toThrow('MODEL_OUTPUT_INVALID');
 }
});
test('legitimate unasked and time-budget closeouts remain recoverable without model calls',async()=>{
 const f=setup(),deps=await createWorkflowFixture(),planned=await planInterviewQuestion(f.initial,f.command,deps);
 const ended=await finishInterviewWorkflow(planned,{identity:f.identity,expectedRevision:planned.revision,mode:'user_stop',sourceGroupId:'g'});
 expect(ended.closeout!.reflection.planning).toMatchObject({issuedCount:1,fallbackCount:0});
 expect(await restoreInterviewWorkflow(JSON.stringify(ended),f.identity)).toEqual(ended);
 const near={...f.initial,state:{...f.initial.state,deadlineAt:f.now+20000}};
 const wrapped=await planInterviewQuestion(near,f.command,{plan:async()=>{throw Error('must not call model');}});
 expect(wrapped.lastPlan).toMatchObject({selection:{status:'finished',plan:{reason:'time_budget'}},receipts:[],modelMessages:0});
 validateWorkflowTransition({action:'plan',snapshot:near,command:f.command},wrapped,Date.now());
});
test('reflection rejects renamed issue IDs even when the executable plan and canonical content are otherwise valid',async()=>{
 const f=setup(),deps=await createWorkflowFixture(),planned=await planInterviewQuestion(f.initial,f.command,deps),q=planned.issuedQuestions[0]!;
 await expect(reflectSession({reportInput:{state:planned.state,generatedAt:Date.now(),policyVersion:planned.policy.id,skillLabels:planned.skillLabels,turns:[]},baselinePolicy:planned.policy,
  generatedAt:Date.now(),sourceGroupId:'g',catalogPin:f.catalogPin,allowDraftKnowledge:true,
  issuedQuestions:[{questionId:'renamed',issuedAt:q.issuedAt,question:q.content!.question,rubric:q.content!.rubric,source:q.content!.source}],
  executedPlans:[{questionId:'renamed',issuedAt:q.issuedAt,...q.content!.effectivePlan!}]})).rejects.toThrow('VALIDATION_ERROR');
});
