import{test,expect}from'bun:test';
import{createReflectionFixture}from'../experiments/reflection/session-fixture.ts';
import{reflectSession}from'../apps/agent/src/reflection/reflect-session.ts';
import{evaluatePolicyCandidate}from'../apps/agent/src/reflection/evaluate-policy.ts';
import{createPolicyValidationSuite}from'../evals/policy/validation-scenarios.ts';
async function fixture(){const source=await createReflectionFixture();const reflection=await reflectSession(source);
 if(!reflection.candidate)throw new Error('Missing fixture candidate');
 return{baseline:reflection.baselinePolicy,candidate:reflection.candidate,suite:createPolicyValidationSuite(),developmentGroupIds:[source.sourceGroupId]};}
test('replays paired cases, improves synthetic match rate and never publishes',async()=>{
 const result=evaluatePolicyCandidate(await fixture());
 expect(result.baseline.matched).toBe(2);expect(result.candidate.matched).toBe(4);expect(result.delta).toBe(0.5);
 expect(result.regressions).toBe(0);expect(result.status).toBe('eligible_for_offline_experiment');
 expect(result.deploymentStatus).toBe('not_published');expect(result.evidenceMode).toBe('synthetic');expect(result.groups).toBe(3);
});
test('rejects development/validation overlap and duplicate case IDs',async()=>{
 const a=await fixture();a.suite.cases[0]!.groupId=a.candidate.sourceGroupId;
 expect(()=>evaluatePolicyCandidate(a)).toThrow('VALIDATION_ERROR');
 const b=await fixture();b.suite.cases[1]!.id=b.suite.cases[0]!.id;
 expect(()=>evaluatePolicyCandidate(b)).toThrow('VALIDATION_ERROR');
});
test('rejects role mismatch, baseline mismatch and changes outside the one-step whitelist',async()=>{
 const a=await fixture();a.suite.roleId='web-frontend';expect(()=>evaluatePolicyCandidate(a)).toThrow('ROLE_FORBIDDEN');
 const b=await fixture();b.candidate.baselineId='other';expect(()=>evaluatePolicyCandidate(b)).toThrow('VERSION_CONFLICT');
 const c=await fixture();c.candidate.parameters.maxTurns=200;expect(()=>evaluatePolicyCandidate(c)).toThrow('VALIDATION_ERROR');
 const d=await fixture();d.candidate.parameters.maxFollowupDepth=0;expect(()=>evaluatePolicyCandidate(d)).toThrow('VALIDATION_ERROR');
});
test('insufficient cases or absent guardrail scenarios reject eligibility',async()=>{
 const a=await fixture();a.suite.cases=a.suite.cases.slice(0,2);
 expect(evaluatePolicyCandidate(a).status).toBe('rejected');
 expect(evaluatePolicyCandidate(a).reasons).toContain('insufficient_cases');
 const b=await fixture();b.suite.cases.forEach(c=>c.tag='general');
 expect(evaluatePolicyCandidate(b).reasons).toContain('missing_guardrail_scenarios');
});
test('no improvement and regressions preserve baseline eligibility status',async()=>{
 const raw=await fixture();for(const c of raw.suite.cases.filter(c=>c.tag==='depth_boundary'))c.expected={action:'deepen',skillId:'primary'};
 const result=evaluatePolicyCandidate(raw);expect(result.status).toBe('rejected');expect(result.regressions).toBe(2);
 expect(result.reasons).toContain('no_improvement');expect(result.deploymentStatus).toBe('not_published');
});
test('development source evidence cannot enter validation through historical memory',async()=>{
 const raw=await fixture();const source=await createReflectionFixture();
 raw.suite.cases[0]!.state.priorEvidence=[{...source.reportInput.state.observations[0]!,sessionId:raw.candidate.sourceSessionId,
  rubricId:'fixture-rubric',rubricVersion:'1',evidenceMode:'offline-fixture'}];
 expect(()=>evaluatePolicyCandidate(raw)).toThrow('VALIDATION_ERROR');
});
