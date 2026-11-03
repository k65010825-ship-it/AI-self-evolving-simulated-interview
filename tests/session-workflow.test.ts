import{test,expect}from'bun:test';
import{runSessionWorkflowDemo}from'../scripts/demo-session-workflow.ts';
import{createWorkflowFixture}from'../experiments/session/fixture.ts';
import{createInterviewWorkflow,planInterviewQuestion,submitInterviewAnswer,finishInterviewWorkflow,restoreInterviewWorkflow}from'../apps/agent/src/orchestration/session-workflow.ts';
import{makeSpeechFixture}from'../experiments/speech/fixture.ts';
import{transcribeSpeech}from'../apps/agent/src/speech/transcribe.ts';
import{confirmSpeechAnswer}from'../apps/agent/src/speech/confirm.ts';
import{WorkflowSchema}from'../packages/contracts/src/session-workflow.ts';
function initial(draft=true){const now=Date.now(),identity={userId:'u',roleId:'java-backend' as const};
 const session=createInterviewWorkflow({identity,session:{sessionId:'test-workflow',roleId:identity.roleId,durationMinutes:20,skills:[{skillId:'project-design',relevance:1}]},
  policy:{id:'pin',roleId:identity.roleId,parameters:{maxFollowupDepth:0,maxTurns:2,wrapUpSeconds:30}},goal:'会话测试',skillLabels:{'project-design':'项目'},allowDraftKnowledge:draft,now});
 return{session,identity,context:{...identity,runId:'plan',attemptId:'a',deadlineAt:now+60000}};}
test('both roles complete first question, two answers and one consistent closeout bundle',async()=>{
 for(const role of ['java-backend','web-frontend']as const){
  const d=await runSessionWorkflowDemo(role);expect(d.session.phase).toBe('completed');expect(d.session.state.observations).toHaveLength(2);
  const c=d.session.closeout!;expect(c.report.sessionVersion).toBe(2);expect(c.memoryCandidate.version).toBe(1);
  expect(c.reflection.sessionId).toBe(c.report.sessionId);expect(c.reflection.baselinePolicy).toEqual(d.session.policy);
  expect(c.reason).toBe('plan_finished');expect(d.liveModelCalls).toBe(0);expect(d.planningCalls).toBe(4);expect(d.scoringCalls).toBe(2);
 }
});

test('ownership, revision and phase guards reject before provider work',async()=>{
 const f=initial();let calls=0;const deps={plan:async()=>{calls++;throw new Error();}};
 await expect(planInterviewQuestion(f.session,{identity:{...f.identity,userId:'other'},expectedRevision:0,context:f.context},deps)).rejects.toThrow('FORBIDDEN');
 await expect(planInterviewQuestion(f.session,{identity:f.identity,expectedRevision:1,context:f.context},deps)).rejects.toThrow('VERSION_CONFLICT');
 await expect(submitInterviewAnswer(f.session,{identity:f.identity,expectedRevision:0,context:f.context,observationId:'o',answer:{id:'a',text:'回答'},quality:1,evidenceMode:'offline-fixture'},
  {evaluate:async()=>{calls++;return {};}})).rejects.toThrow('VERSION_CONFLICT');expect(calls).toBe(0);
});

test('real empty knowledge closes without adding empty growth memory',async()=>{
 const f=initial(false),deps=await createWorkflowFixture();
 const planned=await planInterviewQuestion(f.session,{identity:f.identity,expectedRevision:0,context:f.context},deps);
 expect(planned.phase).toBe('ready_to_close');expect(planned.pendingReason).toBe('knowledge_gap');
 const ended=await finishInterviewWorkflow(planned,{identity:f.identity,expectedRevision:planned.revision,sourceGroupId:'g'});
 expect(ended.closeout?.memoryDisposition).toBe('unchanged_no_answers');expect(ended.closeout?.memoryCandidate.version).toBe(0);
 expect(ended.closeout?.report.coverage.totalAnswers).toBe(0);expect(f.session.phase).toBe('ready_to_plan');
});

test('user stop with pending question keeps it unanswered and completed retries preserve the frozen bundle',async()=>{
 const f=initial(),deps=await createWorkflowFixture();const planned=await planInterviewQuestion(f.session,{identity:f.identity,expectedRevision:0,context:f.context},deps);
 const ended=await finishInterviewWorkflow(planned,{identity:f.identity,expectedRevision:planned.revision,mode:'user_stop',sourceGroupId:'g'});
 expect(ended.state.observations).toHaveLength(0);expect(ended.askedQuestionIds).toHaveLength(1);
 const retry=await finishInterviewWorkflow(ended,{identity:f.identity,expectedRevision:ended.revision,mode:'user_stop',sourceGroupId:'g'});
 expect(retry).toEqual(ended);
 expect(await finishInterviewWorkflow(ended,{identity:f.identity,expectedRevision:planned.revision,mode:'user_stop',sourceGroupId:'g'})).toEqual(ended);
 await expect(finishInterviewWorkflow(ended,{identity:f.identity,expectedRevision:ended.revision,mode:'user_stop',sourceGroupId:'changed'})).rejects.toThrow('VERSION_CONFLICT');
});

test('answer scoring cannot precede question issuance, and replay rejects corrupted issuance chronology',async()=>{
 const f=initial(),deps=await createWorkflowFixture(),planned=await planInterviewQuestion(f.session,{identity:f.identity,expectedRevision:0,context:f.context},deps);
 let calls=0;
 await expect(submitInterviewAnswer(planned,{identity:f.identity,expectedRevision:planned.revision,context:{...f.context,runId:'answer'},
  observationId:'o',answer:{id:'a',text:'回答内容'},quality:1,evidenceMode:'offline-fixture'},
  {now:()=>planned.currentIssuedAt!-1,evaluate:async()=>{calls++;return {};}})).rejects.toThrow('VALIDATION_ERROR');expect(calls).toBe(0);
 const d=await runSessionWorkflowDemo(),bad=structuredClone(d.session);bad.issuedQuestions[0]!.issuedAt=bad.state.observations[0]!.observedAt+1;
 await expect(restoreInterviewWorkflow(JSON.stringify(bad),bad.identity)).rejects.toThrow('VALIDATION_ERROR');
});

test('pending question is revalidated from receipts and repeated identical retrievals are deduplicated',async()=>{
 const f=initial(),deps=await createWorkflowFixture();
 const planned=await planInterviewQuestion(f.session,{identity:f.identity,expectedRevision:0,context:f.context},
  {plan:async(input,signal)=>{const p=await deps.plan(input,signal);return{...p,receipts:[...p.receipts,{...p.receipts[0]!,callId:'again'}]};}});
 expect(planned.current?.question.questionType).toBe('project');
 const corrupted=structuredClone(planned);corrupted.current!.question.text='被替换的题';corrupted.lastPlan!.selection=corrupted.current!;
 await expect(restoreInterviewWorkflow(JSON.stringify(corrupted),f.identity)).rejects.toThrow('VALIDATION_ERROR');
 expect((await restoreInterviewWorkflow(JSON.stringify(planned),f.identity)).revision).toBe(planned.revision);
});

test('confirmed speech binds to issued question and survives report closeout',async()=>{
 const f=initial(),deps=await createWorkflowFixture();const planned=await planInterviewQuestion(f.session,{identity:f.identity,expectedRevision:0,context:f.context},deps);
 const audio=makeSpeechFixture(),t=await transcribeSpeech({...audio.input,context:f.context},{provider:audio.provider});
 const speech=confirmSpeechAnswer(t,{transcriptionId:t.transcriptionId,audioSha256:t.audio.sha256,userId:f.identity.userId,roleId:f.identity.roleId,answerId:'a',text:'确认后的项目方案论证',confirmedAt:Date.now()});
 const answered=await submitInterviewAnswer(planned,{identity:f.identity,expectedRevision:planned.revision,context:{...f.context,runId:'answer'},observationId:'o',answer:speech.answer,speech,quality:1,evidenceMode:'offline-fixture'},deps);
 const ended=await finishInterviewWorkflow(answered,{identity:f.identity,expectedRevision:answered.revision,mode:'user_stop',sourceGroupId:'g'});
 expect(ended.closeout?.report.expression.status).toBe('audio_descriptions');expect(ended.closeout?.memoryCandidate.sessions[0]?.observations).toHaveLength(1);
 expect(ended.turns[0]?.input.question).toEqual(planned.current?.question);
});

test('cancelled or hung planning returns no partial snapshot and original can be retried',async()=>{
 const f=initial(),c={identity:f.identity,expectedRevision:0,context:f.context};
 await expect(planInterviewQuestion(f.session,c,{plan:async()=>new Promise(()=>{}),timeoutMs:5})).rejects.toThrow('DEADLINE_EXCEEDED');
 const controller=new AbortController();let enter!:()=>void;const started=new Promise<void>(r=>{enter=r;});
 const work=planInterviewQuestion(f.session,c,{signal:controller.signal,plan:async()=>{enter();return new Promise(()=>{});}});await started;controller.abort();
 await expect(work).rejects.toThrow('RUN_CANCELLED');expect(f.session.revision).toBe(0);
 const deps=await createWorkflowFixture();expect((await planInterviewQuestion(f.session,c,deps)).phase).toBe('awaiting_answer');
});

test('restore checks report and closeout integrity without committing anything',async()=>{
 const d=await runSessionWorkflowDemo();const original=d.session;
 expect(await restoreInterviewWorkflow(JSON.stringify(original),original.identity)).toEqual(original);
 const altered=structuredClone(original);altered.closeout!.reflection.findings=[];
 await expect(restoreInterviewWorkflow(JSON.stringify(altered),original.identity)).rejects.toThrow('VALIDATION_ERROR');
 await expect(restoreInterviewWorkflow(JSON.stringify(original),{...original.identity,userId:'other'})).rejects.toThrow('FORBIDDEN');
 const empty=structuredClone(original);empty.turns[0]!.proposal.nextState.observations=[];expect(WorkflowSchema.safeParse(empty).success).toBe(false);
});

test('restored growth memory drives a new session without repeating historical questions',async()=>{
 const d=await runSessionWorkflowDemo(),original=d.session,deps=await createWorkflowFixture();
 const next=createInterviewWorkflow({identity:original.identity,session:{sessionId:'next-session',roleId:original.identity.roleId,durationMinutes:20,skills:original.state.skills},
  policy:original.policy,goal:original.goal,skillLabels:original.skillLabels,memory:original.closeout!.memoryCandidate,allowDraftKnowledge:true,now:Date.now()});
 expect(next.state.priorEvidence).toHaveLength(2);expect(next.state.observations).toHaveLength(0);
 const planned=await planInterviewQuestion(next,{identity:next.identity,expectedRevision:0,
  context:{...next.identity,runId:'next-plan',attemptId:'a',deadlineAt:Date.now()+60000}},deps);
 expect(planned.phase).toBe('ready_to_close');expect(planned.pendingReason).toBe('knowledge_gap');
});

test('an ignored abort with a late valid plan cannot publish or mutate the original workflow',async()=>{
 const f=initial(),deps=await createWorkflowFixture();
 const p=await deps.plan({state:f.session.state,context:f.context,goal:f.session.goal,askedQuestionIds:[],planningPolicy:f.session.policy,allowDraftKnowledge:true},new AbortController().signal);
 let resolve!:(v:typeof p)=>void,entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});const controller=new AbortController();
 const work=planInterviewQuestion(f.session,{identity:f.identity,expectedRevision:0,context:f.context},{signal:controller.signal,
  plan:async()=>new Promise(r=>{resolve=r;entered();})});
 await started;controller.abort();await expect(work).rejects.toThrow('RUN_CANCELLED');resolve(p);await Promise.resolve();
 expect(f.session.phase).toBe('ready_to_plan');expect(f.session.askedQuestionIds).toEqual([]);
});
