import {test,expect} from 'bun:test';import {createReflectionFixture} from '../experiments/reflection/session-fixture.ts';
import {reflectSession} from '../apps/agent/src/reflection/reflect-session.ts';import {evaluatePolicyCandidate} from '../apps/agent/src/reflection/evaluate-policy.ts';
import {createPolicyValidationSuite} from '../evals/policy/validation-scenarios.ts';import {createExperimentRegistry,applyExperimentOperation,restoreExperimentRegistry} from '../apps/agent/src/reflection/experiment-registry.ts';
for(const roleId of ['java-backend','web-frontend'] as const)test(`${roleId}: RSI only changes the declared depth, including optional policy parameters`,async()=>{
 const source=await createReflectionFixture(roleId),reflection=await reflectSession(source);if(!reflection.candidate)throw Error('candidate');
 const suite=createPolicyValidationSuite(roleId),base={baseline:reflection.baselinePolicy,candidate:reflection.candidate,suite,developmentGroupIds:[source.sourceGroupId],developmentSessionIds:[reflection.sessionId]};
 expect(evaluatePolicyCandidate(base).status).toBe('eligible_for_offline_experiment');
 const injected=structuredClone(base);injected.candidate.parameters={...injected.candidate.parameters,difficultyProgression:'independent-evidence-v1'};
 expect(()=>evaluatePolicyCandidate(injected)).toThrow('VALIDATION_ERROR');
 const pinned=structuredClone(injected);pinned.baseline.parameters={...pinned.baseline.parameters,difficultyProgression:'independent-evidence-v1'};
 expect(evaluatePolicyCandidate(pinned).status).toBe('eligible_for_offline_experiment');
 const removed=structuredClone(pinned);delete removed.candidate.parameters.difficultyProgression;
 expect(()=>evaluatePolicyCandidate(removed)).toThrow('VALIDATION_ERROR');
 const fallback=structuredClone(base);fallback.candidate.parameters.questionFallback='catalog-unseen-v1';
 expect(()=>evaluatePolicyCandidate(fallback)).toThrow('VALIDATION_ERROR');
 fallback.baseline.parameters.questionFallback='catalog-unseen-v1';
 expect(evaluatePolicyCandidate(fallback).status).toBe('eligible_for_offline_experiment');
 const removedFallback=structuredClone(fallback);delete removedFallback.candidate.parameters.questionFallback;
 expect(()=>evaluatePolicyCandidate(removedFallback)).toThrow('VALIDATION_ERROR');
 const registry=createExperimentRegistry({experimentId:'boundary',roleId,baselinePolicy:base.baseline,now:4000000}),before=JSON.stringify(registry);
 expect(()=>applyExperimentOperation(registry,{experimentId:'boundary',roleId,operationId:'injected',expectedVersion:0,now:4000001,action:'evaluate',evaluationInput:injected})).toThrow('VALIDATION_ERROR');
 expect(JSON.stringify(registry)).toBe(before);
});
for(const roleId of ['java-backend','web-frontend'] as const)test(`${roleId}: restored audit chains cannot hide an undeclared optional policy change`,async()=>{
 const source=await createReflectionFixture(roleId),reflection=await reflectSession(source);if(!reflection.candidate)throw Error('candidate');
 const identity={experimentId:'restore-boundary',roleId},registry=createExperimentRegistry({...identity,baselinePolicy:reflection.baselinePolicy,now:4000000});
 const active=applyExperimentOperation(registry,{...identity,operationId:'valid',action:'evaluate',expectedVersion:0,now:4000001,evaluationInput:{baseline:reflection.baselinePolicy,candidate:reflection.candidate,
  suite:createPolicyValidationSuite(roleId),developmentGroupIds:[source.sourceGroupId],developmentSessionIds:[reflection.sessionId]}});
 expect(restoreExperimentRegistry(JSON.stringify(active),identity)).toEqual(active);
 const altered=structuredClone(active);altered.policies.find(p=>p.id===altered.activePolicyId)!.parameters.difficultyProgression='independent-evidence-v1';
 expect(()=>restoreExperimentRegistry(JSON.stringify(altered),identity)).toThrow('VALIDATION_ERROR');
});
