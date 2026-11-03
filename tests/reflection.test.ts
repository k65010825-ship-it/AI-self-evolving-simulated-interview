import{test,expect}from'bun:test';
import{reflectSession}from'../apps/agent/src/reflection/reflect-session.ts';
import{createReflectionFixture}from'../experiments/reflection/session-fixture.ts';
test('reflects verified coverage/adherence and proposes a bounded one-step depth reduction',async()=>{
 const reflection=await reflectSession(await createReflectionFixture());
 expect(reflection.metrics.skillCoverage.numerator).toBe(1);expect(reflection.metrics.skillCoverage.denominator).toBe(3);
 expect(reflection.metrics.planAdherence.value).toBe(1);expect(reflection.metrics.longestSkillRun).toBe(3);
 if(!reflection.candidate)throw new Error('Expected bounded candidate');
 expect(reflection.candidate.parameters.maxFollowupDepth).toBe(1);
 expect(reflection.candidate.changes).toEqual([{parameter:'maxFollowupDepth',from:2,to:1,reason:'coverage_gap_after_long_skill_run'}]);
 expect(reflection.calibration.mae).toBeNull();expect(reflection.calibration.sampleCount).toBe(0);
 expect(reflection.evidenceMode).toBe('offline-fixture');
});
test('empty denominators are null and insufficient observations do not create a candidate',async()=>{
 const raw=await createReflectionFixture();const first=raw.reportInput.turns[0]!;
 raw.reportInput.state=first.input.state;raw.reportInput.turns=[];
 const reflection=await reflectSession(raw);
 expect(reflection.metrics.planAdherence.value).toBeNull();expect(reflection.metrics.repeatRate.value).toBeNull();
 expect(reflection.candidate).toBeNull();
});
test('rejects wrong policy version, role and forged stored plan',async()=>{
 const a=await createReflectionFixture();a.baselinePolicy.id='wrong';
 await expect(reflectSession(a)).rejects.toThrow('VERSION_CONFLICT');
 const b=await createReflectionFixture();b.baselinePolicy.roleId='web-frontend';
 await expect(reflectSession(b)).rejects.toThrow('ROLE_FORBIDDEN');
 const c=await createReflectionFixture();c.reportInput.turns[0]!.proposal.nextAction.skillId='secondary';
 await expect(reflectSession(c)).rejects.toThrow('VALIDATION_ERROR');
});
test('rejects unpinned legacy policy traces and tampered scores',async()=>{
 const a=await createReflectionFixture();delete(a.reportInput.turns[0]!.input as {planningPolicy?:unknown}).planningPolicy;
 await expect(reflectSession(a)).rejects.toThrow('VALIDATION_ERROR');
 const b=await createReflectionFixture();b.reportInput.turns[0]!.proposal.evaluation.normalizedScore=1;
 await expect(reflectSession(b)).rejects.toThrow('VALIDATION_ERROR');
});
test('does not mutate the baseline',async()=>{
 const raw=await createReflectionFixture();const before=JSON.stringify(raw);await reflectSession(raw);
 expect(JSON.stringify(raw)).toBe(before);
});
test('does not lower depth below one or adjust policy when actual questions ignored the plan',async()=>{
 expect((await reflectSession(await createReflectionFixture('java-backend',1))).candidate).toBeNull();
 const ignored=await reflectSession(await createReflectionFixture('java-backend',2,4));
 expect(ignored.metrics.planAdherence.value).toBeLessThan(1);expect(ignored.candidate).toBeNull();
});
test('a requested difficulty reduction that was not followed is not policy-adherent evidence',async()=>{
 const result=await reflectSession(await createReflectionFixture('java-backend',2,3,2));
 expect(result.metrics.planAdherence.value).toBe(0);expect(result.candidate).toBeNull();
});
