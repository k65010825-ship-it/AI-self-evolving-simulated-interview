import{test,expect}from'bun:test';
import{runWorkflowRsiDemo}from'../scripts/demo-workflow-rsi.ts';
import{evaluateWorkflowRsi}from'../apps/agent/src/reflection/evaluate-workflow-rsi.ts';
import{applyExperimentOperation,createExperimentRegistry}from'../apps/agent/src/reflection/experiment-registry.ts';
import{runSessionWorkflowDemo}from'../scripts/demo-session-workflow.ts';
import{createInterviewWorkflow}from'../apps/agent/src/orchestration/session-workflow.ts';
test('both role closeouts feed isolated policy evaluation and preserve the old session pin',async()=>{
 for(const role of ['java-backend','web-frontend']as const){
  const d=await runWorkflowRsiDemo(role);expect(d.result.status).toBe('evaluated_activated_offline');
  expect(d.result.evaluation?.baseline.value).toBe(.5);expect(d.result.evaluation?.candidate.value).toBe(1);
  expect(d.result.evaluation?.delta).toBe(.5);expect(d.result.nextSessionPin.policy.parameters.maxFollowupDepth).toBe(1);
  expect(d.source.policy.parameters.maxFollowupDepth).toBe(2);expect(d.result.productionPublished).toBe(false);
 }
});

test('ordinary no-candidate closeout skips evaluation without consuming registry version',async()=>{
 const d=await runSessionWorkflowDemo(),snapshot=d.session,now=Date.now(),experimentId='no-candidate';
 const registry=createExperimentRegistry({experimentId,roleId:snapshot.identity.roleId,now,baselinePolicy:snapshot.policy});
 const r=await evaluateWorkflowRsi({identity:snapshot.identity,snapshot,experimentId,registry,expectedRegistryVersion:0,operationId:'skip',nextSessionId:'new-offline-session',now});
 expect(r.status).toBe('skipped_no_candidate');expect(r.evaluation).toBeNull();expect(r.registryCandidate).toEqual(registry);expect(r.appliedNow).toBe(false);
});

test('legal rejected validation preserves active policy and records a failed evaluation',async()=>{
 const d=await runWorkflowRsiDemo(),input=structuredClone(d.input);
 input.suite.cases.filter(c=>c.tag==='depth_boundary').forEach(c=>{c.expected={action:'deepen',skillId:'primary'};});
 const r=await evaluateWorkflowRsi(input);expect(r.status).toBe('evaluated_rejected');expect(r.registryCandidate.version).toBe(1);
 expect(r.activeAfter).toBe(input.registry.activePolicyId);expect(r.evaluation?.reasons).toContain('paired_regressions');expect(input.registry.version).toBe(0);
});

test('group, source session and source-history leakage cannot enter validation',async()=>{
 const d=await runWorkflowRsiDemo();
 for(const mode of ['group','session','prior']as const){const input=structuredClone(d.input),c=input.suite.cases[0]!;
  if(mode==='group')c.groupId=d.source.closeout!.sourceGroupId;
  if(mode==='session')c.state.sessionId=d.source.state.sessionId;
  if(mode==='prior')c.state.priorEvidence=[{...d.source.state.observations[0]!,sessionId:d.source.state.sessionId,rubricId:'r',rubricVersion:'1',
   evidenceMode:'offline-fixture',skillId:'primary',questionId:'leaked-prior',observedAt:c.state.startedAt-1}];
  await expect(evaluateWorkflowRsi(input)).rejects.toThrow('VALIDATION_ERROR');expect(input.registry.version).toBe(0);
 }
 expect(d.result.isolation.developmentSessionIds).toContain(d.source.state.sessionId);expect(d.result.isolation.developmentGroupIds).toContain(d.source.closeout!.sourceGroupId);
});

test('completed source, ownership, registry version and frozen candidate are revalidated',async()=>{
 const d=await runWorkflowRsiDemo();
 await expect(evaluateWorkflowRsi({...d.input,identity:{...d.input.identity,userId:'other'}})).rejects.toThrow('FORBIDDEN');
 await expect(evaluateWorkflowRsi({...d.input,expectedRegistryVersion:99})).rejects.toThrow('VERSION_CONFLICT');
 await expect(evaluateWorkflowRsi({...d.input,nextSessionId:d.source.state.sessionId})).rejects.toThrow('VALIDATION_ERROR');
 const tampered=structuredClone(d.input);tampered.snapshot.closeout!.reflection.candidate!.parameters.maxFollowupDepth=3;
 await expect(evaluateWorkflowRsi(tampered)).rejects.toThrow('VALIDATION_ERROR');
 const snapshot=createInterviewWorkflow({identity:d.source.identity,session:{sessionId:'unfinished',roleId:d.source.identity.roleId,durationMinutes:20,skills:d.source.state.skills},
  policy:d.source.policy,goal:d.source.goal,skillLabels:d.source.skillLabels,now:Date.now()});
 await expect(evaluateWorkflowRsi({...d.input,snapshot})).rejects.toThrow('VERSION_CONFLICT');
});

test('replaying evaluation after rollback does not reactivate the historical winner',async()=>{
 const d=await runWorkflowRsiDemo(),initial=structuredClone(d.source.policy),now=Date.now();
 const rolled=applyExperimentOperation(d.result.registryCandidate,{experimentId:d.input.experimentId,roleId:d.input.identity.roleId,
  expectedVersion:1,operationId:'rollback',action:'rollback',targetPolicyId:initial.id,reason:'离线回滚',now});
 const replay=await evaluateWorkflowRsi({...d.input,registry:rolled,now});
 expect(replay.status).toBe('replayed');expect(replay.recordedOutcome).toBe('activated');expect(replay.appliedNow).toBe(false);
 expect(replay.activeAfter).toBe(initial.id);expect(replay.nextSessionPin.policy).toEqual(initial);expect(replay.registryCandidate.version).toBe(2);
 const originalTime=await evaluateWorkflowRsi({...d.input,registry:rolled},{now:()=>now+1});
 expect(originalTime.status).toBe('replayed');expect(originalTime.activeAfter).toBe(initial.id);expect(originalTime.nextSessionPin.pinnedAt).toBe(now);
 const changed=structuredClone(d.input);changed.suite.version='changed-suite';
 await expect(evaluateWorkflowRsi({...changed,registry:d.result.registryCandidate,now:Date.now()})).rejects.toThrow('VERSION_CONFLICT');
});

test('abort, deadline and absent required validation suite return no experimental candidate',async()=>{
 const d=await runWorkflowRsiDemo(),controller=new AbortController();controller.abort();
 await expect(evaluateWorkflowRsi(d.input,{signal:controller.signal})).rejects.toThrow('RUN_CANCELLED');
 await expect(evaluateWorkflowRsi(d.input,{deadlineAt:1})).rejects.toThrow('DEADLINE_EXCEEDED');
 const{suite:_,...missing}=d.input;await expect(evaluateWorkflowRsi(missing)).rejects.toThrow('VALIDATION_ERROR');
 expect(d.input.registry.version).toBe(0);expect(d.source.policy.parameters.maxFollowupDepth).toBe(2);
});
