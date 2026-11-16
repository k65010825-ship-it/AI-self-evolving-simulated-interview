import {test,expect} from 'bun:test';
import {runDurableClarificationAcceptance} from '../experiments/durable-clarification/acceptance.ts';
for(const role of ['java-backend','web-frontend']as const)test(`${role}: actual child exit preserves targeted receipt and budgets; append-only continuation is idempotent`,async()=>{
 const r=await runDurableClarificationAcceptance(role);
 expect(r.childExitCode).toBe(0);expect(r.template).toBe('observation-v1');
 expect(r.childHttpAttempts).toBe(1);expect(r.childCredentialReads).toBe(1);expect(r.authorizationRunsUsed).toBe(3);
 expect(r.exactResultReplay).toBe(true);expect(r.exactEventReplay).toBe(true);expect(r.exactBudgetReplay).toBe(true);
 expect(r.replayCredentialReads).toBe(0);expect(r.replayHttpAttempts).toBe(0);
 expect(r.continuationStatus).toBe('completed');expect(r.observations).toBe(1);expect(r.normalizedScore).toBe(.75);
 expect(r.continuationHttpAttempts).toBe(1);expect(r.duplicateContinuationReplay).toBe(true);
 expect(r.rewriteStatus).toBe('failed');expect(r.rewriteError).toBe('VERSION_CONFLICT');expect(r.changedRequestRejected).toBe(true);
 expect(r.totalSettledTokens).toBe(260);expect(r.budgetRows).toBe(2);expect(r.originalBudgetUnchanged).toBe(true);
 expect(r.liveModelCalls).toBe(0);expect(r.formalCommitted).toBe(false);
},20000);
