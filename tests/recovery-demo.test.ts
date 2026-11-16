import{test,expect}from'bun:test';
import{runModelRecoveryDemo}from'../scripts/demo-model-recovery.ts';
test('both roles recover through real Pi tool loops with injected HTTP and keep conservative rejected holds',async()=>{
 const r=await runModelRecoveryDemo();
 expect(r.scope).toBe('injected-http-pi-recovery');expect(r.liveModelCalls).toBe(0);expect(r.formalCommitted).toBe(false);
 expect(r.report.mode).toBe('injected-http');expect(r.report.status).toBe('passed-mechanics');expect(r.report.httpAttempts).toBe(10);
 expect(r.report.plan.recovery.maxModelRepairs).toBe(1);expect(r.report.settledTokens).toBe(1040);expect(r.rejectedPendingReconciliation).toBe(2);
 expect(r.report.heldCostMicros).toBeGreaterThan(0);expect(r.report.recoveryDiagnostics).toHaveLength(2);
 expect(r.report.cases.every(c=>c.mechanicsPassed)).toBe(true);
 expect(JSON.stringify(r)).not.toContain('synthetic-recovery-credential');
});
