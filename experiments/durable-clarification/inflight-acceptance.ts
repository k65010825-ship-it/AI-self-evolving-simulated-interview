import {createDurableLiveRunManager} from '../../apps/agent/src/runtime/durable-runtime.ts';
import {fixtureStream} from './fixture.ts';
import {createInflightClarificationCrash} from './inflight-fixture.ts';
import {BudgetReconciliationSchema} from '../../packages/contracts/src/durable-runtime.ts';
import type {z} from 'zod';
import type {RoleId} from '../../packages/contracts/src/tools.ts';
import {contentHash} from '../../evals/answers/validation.ts';
export async function runInflightClarificationAcceptance(role:RoleId){
 const {output,database,c,first,m,pending,crashed,replacement,childExitCode,now}=await createInflightClarificationCrash(role);
 let recoveryHttpAttempts=0,recoveryCredentialReads=0;
 const r=createDurableLiveRunManager(c,{now:()=>now,readCredential:()=>{recoveryCredentialReads++;throw Error('forbidden');},fetch:async()=>{recoveryHttpAttempts++;throw Error('forbidden');}},{path:database,ownerId:'recovered'});
 let pendingReceiptRetained=false,originalBudgetRetained=false,taskAfterRecovery:string,oldResultStatus:string,unknownHeldTokens=0,blockedBeforeReconcile=false;
 let staleVersionRejected=false,wrongIdentityRejected=false,invalidReconcileUnchanged=false,reconciliationKind:string,conflictingUsageRejected=false;
 let command:z.infer<typeof BudgetReconciliationSchema>,reconciledDigest='',receiptDigest='',oldFailedDigest='';
 const fails=(fn:()=>unknown,code:string)=>{try{fn();return false;}catch(e){return e instanceof Error&&e.message===code;}};
 try{
  const original=r.start(first.request);pendingReceiptRetained=contentHash(original)===m.firstResultDigest&&original.result?.kind==='uncommitted-unscored-turn-result'&&original.result.resolution.clarificationTemplate==='observation-v1';
  originalBudgetRetained=r.modelAccounting().some(s=>contentHash(s)===m.firstBudgetDigest);
  taskAfterRecovery=r.durableTasks(crashed.context.runId)!.status;oldResultStatus=r.start(crashed).status;
  oldFailedDigest=contentHash(r.snapshot(crashed.context.runId));
  const unknown=r.modelAccounting().find(s=>s.entries.some(e=>e.status==='unknown'));if(!unknown)throw Error('UNKNOWN_NOT_PRESERVED');unknownHeldTokens=unknown.totals.heldTokens;
  blockedBeforeReconcile=fails(()=>r.start(replacement),'DEPENDENCY_UNAVAILABLE');
  const entry=unknown.entries.find(e=>e.status==='unknown')!;
  command={runId:crashed.context.runId,attemptId:crashed.context.attemptId,identity:{userId:crashed.context.userId,roleId:role},expectedVersion:unknown.version,callId:entry.callId,
   usage:{inputTokens:100,outputTokens:30,complete:true},evidenceRef:'synthetic-host-usage-for-crashed-continuation'};
  const before=contentHash(r.modelAccounting());
  staleVersionRejected=fails(()=>r.reconcile({...command,expectedVersion:unknown.version+1}),'DURABLE_BUDGET_CONFLICT');
  wrongIdentityRejected=fails(()=>r.reconcile({...command,identity:{...command.identity,userId:'another-user'}}),'DURABLE_FORBIDDEN');
  invalidReconcileUnchanged=before===contentHash(r.modelAccounting());
  const reconciled=r.reconcile(command);reconciliationKind=reconciled.kind;receiptDigest=contentHash(reconciled.receipt);
  conflictingUsageRejected=fails(()=>r.reconcile({...command,usage:{inputTokens:101,outputTokens:30,complete:true}}),'DURABLE_RECONCILIATION_CONFLICT');
  reconciledDigest=contentHash(r.modelAccounting());
 }finally{r.close();}
 let newHttpAttempts=0;
 const resumed=createDurableLiveRunManager(c,{now:()=>now,readCredential:()=> 'synthetic-only',fetch:async()=>{newHttpAttempts++;return fixtureStream(pending.output);}},{path:database,ownerId:'post-reconcile'});
 let reconciliationReplayKind:string,reconciliationReceiptStable=false,reconciledBudgetPersisted=false,oldTaskStillFailed=false,oldResultReplayIdentical=false,newTaskStatus:string,newTaskObservations=0,newTaskReplayUnchanged=false,totalSyntheticTokens=0;
 try{
  reconciledBudgetPersisted=contentHash(resumed.modelAccounting())===reconciledDigest;
  const replayed=resumed.reconcile(command);reconciliationReplayKind=replayed.kind;reconciliationReceiptStable=contentHash(replayed.receipt)===receiptDigest;
  const old=resumed.start(crashed);oldTaskStillFailed=old.status==='failed';oldResultReplayIdentical=contentHash(old)===oldFailedDigest;
  resumed.start(replacement);await resumed.wait(replacement.context.runId);const next=resumed.snapshot(replacement.context.runId);newTaskStatus=next.status;
  if(next.result?.kind==='uncommitted-turn-result')newTaskObservations=next.result.proposal.nextState.observations.length;
  const budget=contentHash(resumed.modelAccounting());newTaskReplayUnchanged=contentHash(resumed.start(replacement))===contentHash(next)&&contentHash(resumed.modelAccounting())===budget;
  totalSyntheticTokens=resumed.modelAccounting().reduce((sum,s)=>sum+s.totals.usedTokens,0);
 }finally{resumed.close();}
 return {role,output,childExitCode,childHttpAttempts:m.httpAttempts,pendingReceiptRetained,originalBudgetRetained,taskAfterRecovery,oldResultStatus,unknownHeldTokens,
  reservationPreserved:unknownHeldTokens===m.heldTokens,recoveryHttpAttempts,recoveryCredentialReads,blockedBeforeReconcile,staleVersionRejected,wrongIdentityRejected,invalidReconcileUnchanged,
  reconciliationKind,reconciliationReplayKind,reconciliationReceiptStable,conflictingUsageRejected,reconciledBudgetPersisted,oldTaskStillFailed,oldResultReplayIdentical,newTaskStatus,newTaskObservations,newHttpAttempts,newTaskReplayUnchanged,totalSyntheticTokens,
  reconciliationAuthority:'host-supplied-usage-not-vendor-verified' as const,liveModelCalls:0 as const,formalCommitted:false as const};
}
