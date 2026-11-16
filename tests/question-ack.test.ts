import { test, expect } from 'bun:test';
import type { AgentRunRequest } from '../packages/contracts/src/agent-run.ts';
import { createWorkflowCommitFixtureStore } from '../experiments/commit/fixture-store.ts';
import { commitSource } from './helpers/commit-source.ts';
import { createQuestionPresentation, prepareQuestionAcknowledgement, resumeQuestionPresentation, requireQuestionAcknowledged } from '../packages/agent-client/src/question-ack.ts';
import { workflowCommitDigest } from '../packages/agent-client/src/workflow-commit.ts';
import { createQuestionAckFixtureStore } from '../experiments/commit/question-ack-store.ts';

async function source(){
 const f=await commitSource(),store=createWorkflowCommitFixtureStore({identity:f.identity,sessionId:f.ticket.sessionId,memory:f.current.memory});
 const create=store.stage(f.request,{operationId:'create',taskId:'create',now:Date.now(),leaseMs:30000});store.apply(store.prepare(create,f.run,Date.now()),Date.now());
 const before=store.current().session!,context={...f.request.context,runId:'ack-plan',deadlineAt:Date.now()+60000};
 const request:AgentRunRequest={inputSnapshotId:'ack-input',context,job:{type:'workflow',operation:{action:'plan',snapshot:before.workflow,command:{identity:f.identity,expectedRevision:before.workflow.revision,context}}}};
 const task=store.stage(request,{operationId:'plan',taskId:'plan',now:Date.now(),leaseMs:30000});
 const receipt=store.apply(store.prepare(task,await f.execute(request),Date.now()),Date.now()).receipt;
 const stored=store.current().session!,now=Date.now();
 const record=createQuestionPresentation({identity:f.identity,stored,commitReceipt:receipt,deliveryId:'delivery-1',now});
 const command={deliveryId:record.packet.deliveryId,sessionId:record.packet.sessionId,questionId:record.packet.questionId,textDigest:record.packet.textDigest,commandId:'ack-1',clientInstanceId:'window-1'};
 return{...f,stored,receipt,record,command,now};
}

test('presentation requires committed plan bindings and exposes only the fixed student packet',async()=>{
 const f=await source();try{
  expect(f.record.packet.text).toBe(f.stored.workflow.issuedQuestions.at(-1)!.content!.text);
  expect(Object.keys(f.record.packet).sort()).toEqual(['deliveryId','expiresAt','issuedAt','questionId','roleId','sessionId','text','textDigest'].sort());
  expect(f.record.acknowledgement).toBeNull();
  expect(createQuestionPresentation({identity:f.identity,stored:f.stored,commitReceipt:f.receipt,deliveryId:'new-id-must-not-replace',existing:f.record,now:f.now+1})).toEqual(f.record);
  expect(()=>createQuestionPresentation({identity:f.identity,stored:f.stored,commitReceipt:{...f.receipt,candidateDigest:'0'.repeat(64)},deliveryId:'bad',now:f.now})).toThrow('PRESENTATION_BINDING_INVALID');
  expect(()=>createQuestionPresentation({identity:f.identity,stored:f.stored,commitReceipt:f.receipt,deliveryId:'bad',now:f.stored.workflow.state.deadlineAt})).toThrow('PRESENTATION_EXPIRED');
 }finally{f.runtime.dispose();}
});

test('acknowledgement is an uncommitted CAS plan; exact replay returns original receipt without reopening an old question',async()=>{
 const f=await source();try{
  const input={identity:f.identity,stored:f.stored,record:f.record,command:f.command,now:f.now};
  const gate={identity:f.identity,stored:f.stored,record:f.record,now:f.now};
  expect(()=>requireQuestionAcknowledged(gate)).toThrow('PRESENTATION_NOT_ACKNOWLEDGED');
  const plan=prepareQuestionAcknowledgement(input);
  if(plan.kind!=='uncommitted-question-ack-plan')throw Error('plan');
  expect(plan.committed).toBe(false);expect(plan.next.version).toBe(1);expect(plan.receipt.confirmationSource).toBe('client-reported');
  expect(plan.where.workflowDigest).toBe(workflowCommitDigest(f.stored.workflow));
  expect(requireQuestionAcknowledged({...gate,record:plan.next}).questionId).toBe(f.command.questionId);
  const replay=prepareQuestionAcknowledgement({...input,record:plan.next,now:f.now+1});
  expect(replay.kind).toBe('question-ack-replay');expect(replay.receipt).toEqual(plan.receipt);
  const later=structuredClone(f.stored);later.workflow.phase='ready_to_close';later.workflow.pendingReason='knowledge_gap';later.workflow.current=null;later.workflow.currentIssuedAt=null;
  expect(prepareQuestionAcknowledgement({...input,stored:later,record:plan.next,now:f.now+1}).kind).toBe('question-ack-replay');
  expect(resumeQuestionPresentation({...gate,stored:later,record:plan.next,now:f.now+1}).status).toBe('unavailable');
  expect(()=>prepareQuestionAcknowledgement({...input,record:plan.next,command:{...f.command,commandId:'other'}})).toThrow('PRESENTATION_OPERATION_CONFLICT');
 }finally{f.runtime.dispose();}
});

test('reconnect preserves packet and acknowledgement; missing, legacy, stale, expired and cross-user never fabricate confirmation',async()=>{
 const f=await source();try{
  const input={identity:f.identity,stored:f.stored,record:f.record,now:f.now};
  const pending=resumeQuestionPresentation(input);expect(pending.status).toBe('awaiting-ack');expect(pending.packet).toEqual(f.record.packet);
  expect(resumeQuestionPresentation({...input,record:null}).reason).toBe('unregistered');
  const legacy=structuredClone(f.stored);for(const q of legacy.workflow.issuedQuestions)delete q.content;
  expect(resumeQuestionPresentation({...input,stored:legacy}).reason).toBe('legacy-content-missing');
  expect(resumeQuestionPresentation({...input,now:f.record.packet.expiresAt}).reason).toBe('expired');
  const stale=structuredClone(f.record);stale.workflowDigest='f'.repeat(64);
  expect(resumeQuestionPresentation({...input,record:stale}).reason).toBe('stale');
  expect(()=>resumeQuestionPresentation({...input,identity:{...f.identity,userId:'other'}})).toThrow('PRESENTATION_FORBIDDEN');
  for(const change of [{textDigest:'0'.repeat(64)},{questionId:'other'},{deliveryId:'old'},{sessionId:'other'}])expect(()=>prepareQuestionAcknowledgement({...input,command:{...f.command,...change}})).toThrow('PRESENTATION_BINDING_INVALID');
  expect(()=>prepareQuestionAcknowledgement({...input,command:f.command,now:f.record.createdAt-1})).toThrow('PRESENTATION_CLOCK_INVALID');
 }finally{f.runtime.dispose();}
});

test('two ack candidates race; store checks current row and immutable admitted plans, and JSON reload preserves exact receipt',async()=>{
 const f=await source();try{
  let row=f.stored;
  const store=createQuestionAckFixtureStore(f.record,()=>row);
  const a=store.prepare(f.command,f.now),b=store.prepare({...f.command,commandId:'ack-other',clientInstanceId:'window-2'},f.now);
  const changed=structuredClone(a);if(changed.kind==='uncommitted-question-ack-plan')changed.next.packet.text='forged';
  expect(()=>store.apply(changed,f.now)).toThrow('PRESENTATION_BINDING_INVALID');
  expect(()=>store.apply(a,f.now,{failBeforeCommit:true})).toThrow('ACK_FIXTURE_ABORT');expect(store.current().version).toBe(0);
  expect(store.apply(a,f.now).effect).toBe('applied-in-memory');
  expect(()=>store.apply(b,f.now)).toThrow('PRESENTATION_OPERATION_CONFLICT');
  const saved=JSON.parse(JSON.stringify(store.current())),restored=createQuestionAckFixtureStore(saved,()=>row);
  expect(restored.current()).toEqual(store.current());
  const replay=restored.prepare(f.command,f.now+1);expect(restored.apply(replay,f.now+1).effect).toBe('replayed-in-memory');
  expect(resumeQuestionPresentation({identity:f.identity,stored:row,record:restored.current(),now:f.now+1}).shouldAcknowledge).toBe(false);
  const pending=createQuestionAckFixtureStore(f.record,()=>row),p=pending.prepare(f.command,f.now);
  row={...row,storageVersion:row.storageVersion+1};
  expect(()=>pending.apply(p,f.now)).toThrow('PRESENTATION_STALE');expect(pending.current().version).toBe(0);
  // A fresh candidate can use a newer storage version with identical semantic workflow (e.g. restore).
  expect(pending.apply(pending.prepare(f.command,f.now),f.now).effect).toBe('applied-in-memory');
 }finally{f.runtime.dispose();}
});
