import {test,expect} from 'bun:test';
import {runHttpRecoveryAcceptance} from '../experiments/durable-clarification/http-acceptance.ts';
for(const role of ['java-backend','web-frontend']as const)test(`${role}: real TCP recovery preserves failed results, resumes SSE and never auto-reposts unknown work`,async()=>{
 const r=await runHttpRecoveryAcceptance(role);
 expect(r.transport).toBe('tcp');expect(r.pendingTemplate).toBe('observation-v1');expect(r.failedExecuteCode).toBe('DEPENDENCY_UNAVAILABLE');
 expect(r.failedExecutePosts).toBe(1);expect(r.blockedExecuteCode).toBe('DEPENDENCY_UNAVAILABLE');expect(r.blockedExecutePosts).toBe(1);
 expect(r.sseReconnectRequests).toBe(2);expect(r.lastEventIdUsed).toBe(true);expect(r.contiguousEvents).toBe(true);
 expect(r.restartTailMatches).toBe(true);expect(r.restartBudgetMatches).toBe(true);expect(r.wrongAttemptRejected).toBe(true);expect(r.futureCursorRejected).toBe(true);
 expect(r.preReconcileModelAttempts).toBe(0);expect(r.preReconcileCredentialReads).toBe(0);
 expect(r.newTaskStatus).toBe('completed');expect(r.newTaskEventsObserved).toBe(true);expect(r.newTaskObservations).toBe(1);
 expect(r.newModelAttempts).toBe(1);expect(r.duplicateBudgetUnchanged).toBe(true);expect(r.oldFailedStillFailed).toBe(true);
 expect(r.totalSyntheticTokens).toBe(390);expect(r.liveModelCalls).toBe(0);expect(r.formalCommitted).toBe(false);
},20000);
