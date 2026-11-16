import {test,expect} from 'bun:test';
import {runInflightClarificationAcceptance} from '../experiments/durable-clarification/inflight-acceptance.ts';
for(const role of ['java-backend','web-frontend']as const)test(`${role}: a crashed continuation remains unknown and requires explicit durable reconciliation`,async()=>{
 const r=await runInflightClarificationAcceptance(role);
 expect(r.childExitCode).toBe(23);expect(r.childHttpAttempts).toBe(2);expect(r.pendingReceiptRetained).toBe(true);expect(r.originalBudgetRetained).toBe(true);
 expect(r.taskAfterRecovery).toBe('interrupted');expect(r.oldResultStatus).toBe('failed');expect(r.unknownHeldTokens).toBeGreaterThan(0);
 expect(r.reservationPreserved).toBe(true);
 expect(r.recoveryHttpAttempts).toBe(0);expect(r.recoveryCredentialReads).toBe(0);expect(r.blockedBeforeReconcile).toBe(true);
 expect(r.staleVersionRejected).toBe(true);expect(r.wrongIdentityRejected).toBe(true);expect(r.invalidReconcileUnchanged).toBe(true);
 expect(r.reconciliationKind).toBe('reconciled');expect(r.reconciliationReplayKind).toBe('replayed');expect(r.conflictingUsageRejected).toBe(true);
 expect(r.reconciliationReceiptStable).toBe(true);expect(r.oldResultReplayIdentical).toBe(true);
 expect(r.reconciledBudgetPersisted).toBe(true);expect(r.oldTaskStillFailed).toBe(true);
 expect(r.newTaskStatus).toBe('completed');expect(r.newTaskObservations).toBe(1);expect(r.newHttpAttempts).toBe(1);expect(r.newTaskReplayUnchanged).toBe(true);
 expect(r.totalSyntheticTokens).toBe(390);expect(r.liveModelCalls).toBe(0);expect(r.formalCommitted).toBe(false);
},20000);
