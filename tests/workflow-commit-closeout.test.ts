import { test, expect } from 'bun:test';
import { finishCommitFixture } from './helpers/finish-commit-fixture.ts';
import { commitSource } from './helpers/commit-source.ts';
import { createWorkflowCommitFixtureStore } from '../experiments/commit/fixture-store.ts';
import type { AgentRunRequest } from '../packages/contracts/src/agent-run.ts';
import { ContentReportSchema } from '../packages/contracts/src/report.ts';

test('closeout session, profile and receipt apply together; simulated failure leaves no partial state', async () => {
  const f = await finishCommitFixture();
  try {
    const before = f.store.current(), count = f.store.receiptCount();
    expect(() => f.store.apply(f.finish.plan, Date.now(), { failBeforeCommit: true })).toThrow('COMMIT_FIXTURE_ABORT');
    expect(f.store.current()).toEqual(before); expect(f.store.receiptCount()).toBe(count);
    const applied = f.store.apply(f.finish.plan, Date.now());
    expect(applied.formalCommitted).toBe(false); expect(f.store.current().memory.version).toBe(1);
    expect(f.store.current().session!.workflow.phase).toBe('completed');
    expect(f.store.apply(f.finish.plan, Date.now()).effect).toBe('replayed-in-memory');
    expect(f.store.receiptCount()).toBe(count + 1);
  } finally { f.runtime.dispose(); }
});
test('new deterministic feedback is admitted but jointly forged card/action text is rejected',async()=>{
 const f=await finishCommitFixture();
 try{
  const run=structuredClone(f.finish.run);if(run.result?.kind!=='uncommitted-workflow-result'||!run.result.snapshot.closeout)throw Error('Expected closeout');
  const report=run.result.snapshot.closeout.report,ref=report.studyPlan.flatMap(p=>p.feedbackRefs??[])[0];if(!ref)throw Error('Expected feedback ref');
  const card=report.assessments.find(a=>a.answerId===ref.answerId)!.criterionFeedback!.find(c=>c.criterionId===ref.criterionId)!;
  card.action='共同篡改的建议文本';for(const p of report.studyPlan)for(const[i,r]of(p.feedbackRefs??[]).entries())if(r.answerId===ref.answerId&&r.criterionId===ref.criterionId)p.actions[i]=card.action;
  expect(ContentReportSchema.safeParse(report).success).toBe(true);
  expect(()=>f.store.prepare(f.finish.taskId,run,Date.now())).toThrow('COMMIT_TRANSITION_INVALID');
 }finally{f.runtime.dispose();}
});
test('a profile changed by another session blocks the whole pending closeout', async () => {
  const f = await finishCommitFixture();
  try {
    if (f.finish.plan.kind !== 'uncommitted-workflow-commit-plan' || !f.finish.plan.memoryWrite) throw new Error('Expected profile append');
    const other = structuredClone(f.finish.plan.memoryWrite), session = other.sessions.at(-1)!;
    session.sessionId = 'other-completed-session'; session.observations.forEach(o => o.sessionId = session.sessionId);
    f.store.advanceMemory(other);
    const before = f.store.current();
    expect(() => f.store.apply(f.finish.plan, Date.now())).toThrow('COMMIT_MEMORY_CONFLICT');
    expect(f.store.current()).toEqual(before);
    expect(f.store.current().session!.workflow.phase).toBe('ready_to_close');
    expect(() => f.store.prepare(f.finish.taskId, f.finish.run, Date.now())).toThrow('COMMIT_MEMORY_CONFLICT');
  } finally { f.runtime.dispose(); }
});

test('closeout cannot drop publication metadata or rewrite visible feedback even with a valid report shape',async()=>{
 const f=await finishCommitFixture();
 try{
  const changed=structuredClone(f.finish.run);if(changed.result?.kind!=='uncommitted-workflow-result'||!changed.result.snapshot.closeout)throw Error('closeout');
  const a=changed.result.snapshot.closeout.report.assessments[0]!;delete a.feedbackPublication;
  expect(ContentReportSchema.safeParse(changed.result.snapshot.closeout.report).success).toBe(true);
  expect(()=>f.store.prepare(f.finish.taskId,changed,Date.now())).toThrow('COMMIT_TRANSITION_INVALID');
  const text=structuredClone(f.finish.run);if(text.result?.kind!=='uncommitted-workflow-result'||!text.result.snapshot.closeout)throw Error('closeout');
  text.result.snapshot.closeout.report.assessments[0]!.feedback.improvements[0]='篡改后的发布意见';
  expect(ContentReportSchema.safeParse(text.result.snapshot.closeout.report).success).toBe(true);
  expect(()=>f.store.prepare(f.finish.taskId,text,Date.now())).toThrow('COMMIT_TRANSITION_INVALID');
 }finally{f.runtime.dispose();}
});
test('finish retry and restore keep workflow revision but advance storage CAS version for new operations', async () => {
  const f = await finishCommitFixture();
  try {
    f.store.apply(f.finish.plan, Date.now());
    const old = f.store.current().session!, snapshot = old.workflow;
    if (f.finish.request.job.type !== 'workflow' || f.finish.request.job.operation.action !== 'finish') throw new Error('Expected finish');
    const command = f.finish.request.job.operation.command;
    await f.invoke(() => ({ action: 'finish', snapshot, command }));
    expect(f.store.current().session!.workflow.revision).toBe(snapshot.revision);
    expect(f.store.current().session!.storageVersion).toBe(old.storageVersion + 1);
    const restored = f.store.current().session!.workflow;
    await f.invoke(() => ({ action: 'restore', snapshot: restored }));
    expect(f.store.current().session!.storageVersion).toBe(old.storageVersion + 2);
    expect(f.store.current().memory.version).toBe(1);
  } finally { f.runtime.dispose(); }
});

test('closeout cannot rewrite old answer history or report assessment arithmetic', async () => {
  const f = await finishCommitFixture();
  try {
    const run = structuredClone(f.finish.run);
    if (run.result?.kind !== 'uncommitted-workflow-result' || !run.result.snapshot.closeout) throw new Error('Expected closeout');
    run.result.snapshot.closeout.report.assessments[0]!.evaluation.normalizedScore = .99;
    expect(() => f.store.prepare(f.finish.taskId, run, Date.now())).toThrow('COMMIT_TRANSITION_INVALID');
    const old = structuredClone(f.finish.run);
    if (old.result?.kind !== 'uncommitted-workflow-result') throw new Error('Expected workflow');
    old.result.snapshot.turns[0]!.input.answer.text += 'rewritten';
    expect(() => f.store.prepare(f.finish.taskId, old, Date.now())).toThrow('COMMIT_TRANSITION_INVALID');
  } finally { f.runtime.dispose(); }
});

test('offline turn provenance cannot be upgraded through report, reflection or memory labels', async () => {
  const f = await finishCommitFixture();
  try {
    const run = structuredClone(f.finish.run);
    if (run.result?.kind !== 'uncommitted-workflow-result' || !run.result.snapshot.closeout) throw new Error('Expected closeout');
    const close = run.result.snapshot.closeout;
    close.report.evidenceMode = 'live-model'; close.reflection.evidenceMode = 'live-model'; close.memoryCandidate.sessions.at(-1)!.evidenceMode = 'live-model';
    expect(() => f.store.prepare(f.finish.taskId, run, Date.now())).toThrow('COMMIT_TRANSITION_INVALID');
  } finally { f.runtime.dispose(); }
});

test('user-stop without answers closes once without appending empty profile evidence', async () => {
  const f = await commitSource();
  try {
    const store = createWorkflowCommitFixtureStore({ identity: f.identity, sessionId: f.ticket.sessionId, memory: f.current.memory });
    const create = store.stage(f.request, { taskId: 'create', operationId: 'create', now: Date.now(), leaseMs: 30000 });
    store.apply(store.prepare(create, f.run, Date.now()), Date.now());
    const snapshot = store.current().session!.workflow, context = { ...f.request.context, runId: 'empty-close' };
    const request: AgentRunRequest = { inputSnapshotId: 'empty-close', context, job: { type: 'workflow', operation: { action: 'finish', snapshot,
      command: { identity: f.identity, expectedRevision: snapshot.revision, mode: 'user_stop', sourceGroupId: 'empty-fixture' } } } };
    const task = store.stage(request, { taskId: 'finish', operationId: 'finish', now: Date.now(), leaseMs: 30000 });
    const decision = store.prepare(task, await f.execute(request), Date.now());
    if (decision.kind !== 'uncommitted-workflow-commit-plan') throw new Error('Expected plan');
    expect(decision.memoryWrite).toBeNull(); store.apply(decision, Date.now());
    expect(store.current().memory.version).toBe(0); expect(store.current().session!.workflow.phase).toBe('completed');
    expect(store.current().session!.workflow.closeout!.report.evidenceMode).toBe('unverified');
  } finally { f.runtime.dispose(); }
});
