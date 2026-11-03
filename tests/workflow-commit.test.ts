import { test, expect } from 'bun:test';
import { prepareWorkflowCommit, createWorkflowCommitTicket } from '../packages/agent-client/src/workflow-commit.ts';
import { commitSource } from './helpers/commit-source.ts';

test('completed create admits an uncommitted storage plan bound to trusted task and snapshot', async () => {
  const f = await commitSource();
  try {
    const p = prepareWorkflowCommit({ ticket: f.ticket, request: f.request, run: f.run, current: f.current, receipt: null, now: Date.now() });
    expect(p.kind).toBe('uncommitted-workflow-commit-plan');
    if (p.kind !== 'uncommitted-workflow-commit-plan') throw new Error('Expected plan');
    expect(p.where.expectedStorageVersion).toBeNull(); expect(p.sessionWrite.storageVersion).toBe(0);
    expect(p.memoryWrite).toBeNull(); expect(p.committed).toBe(false);
  } finally { f.runtime.dispose(); }
});

test('acceptance, wrong run/attempt/input identity, revoked task and expired lease never grant a commit', async () => {
  const f = await commitSource();
  try {
    const base = { ticket: f.ticket, request: f.request, run: f.run, current: f.current, receipt: null, now: Date.now() };
    for (const change of [{ runId: 'other' }, { attemptId: 'old' }, { inputSnapshotId: 'other' }])
      expect(() => prepareWorkflowCommit({ ...base, run: { ...f.run, ...change } })).toThrow('COMMIT_BINDING_INVALID');
    const accepted = { ...f.run, status: 'running', stage: 'queued', result: null };
    expect(() => prepareWorkflowCommit({ ...base, run: accepted })).toThrow('COMMIT_NOT_COMPLETED');
    expect(() => prepareWorkflowCommit({ ...base, ticket: { ...f.ticket, status: 'cancelled' } })).toThrow('COMMIT_TASK_INACTIVE');
    expect(() => prepareWorkflowCommit({ ...base, now: f.ticket.leaseUntil })).toThrow('COMMIT_LEASE_EXPIRED');
    const changed = structuredClone(f.request); changed.context.deadlineAt--;
    expect(() => prepareWorkflowCommit({ ...base, request: changed })).toThrow('COMMIT_BINDING_INVALID');
  } finally { f.runtime.dispose(); }
});

test('schema-valid candidate changes and operation receipt collisions are rejected', async () => {
  const f = await commitSource();
  try {
    const base = { ticket: f.ticket, request: f.request, run: f.run, current: f.current, receipt: null, now: Date.now() };
    const changed = structuredClone(f.run);
    if (changed.result?.kind !== 'uncommitted-workflow-result') throw new Error('Expected workflow');
    changed.result.snapshot.goal = 'schema-valid-but-unrequested';
    expect(() => prepareWorkflowCommit({ ...base, run: changed })).toThrow('COMMIT_TRANSITION_INVALID');
    const plan = prepareWorkflowCommit(base);
    if (plan.kind !== 'uncommitted-workflow-commit-plan') throw new Error('Expected plan');
    const committedTicket = { ...f.ticket, status: 'committed' };
    expect(() => prepareWorkflowCommit({ ...base, ticket: committedTicket, receipt: plan.receiptCandidate, run: changed,
      now: f.ticket.deadlineAt + 1000 })).toThrow('COMMIT_OPERATION_CONFLICT');
  } finally { f.runtime.dispose(); }
});

test('report jobs are explicitly unsupported rather than admitted through a workflow fallback', async () => {
  const f = await commitSource();
  try {
    if (f.run.result?.kind !== 'uncommitted-workflow-result') throw new Error('Expected workflow');
    const w = f.run.result.snapshot;
    const request = { ...f.request, job: { type: 'report', input: { state: w.state, generatedAt: Date.now(), policyVersion: w.policy.id, skillLabels: w.skillLabels, turns: [] } } };
    expect(() => createWorkflowCommitTicket({ identity: f.identity, request, operationId: 'report', taskId: 'report', leaseVersion: 1,
      expectedStorageVersion: null, expectedMemoryVersion: 0, issuedAt: Date.now(), leaseUntil: Date.now() + 30000 })).toThrow('COMMIT_UNSUPPORTED_JOB');
    expect(() => prepareWorkflowCommit({ ticket: f.ticket, request, run: f.run, current: f.current, receipt: null, now: Date.now() })).toThrow('COMMIT_UNSUPPORTED_JOB');
  } finally { f.runtime.dispose(); }
});
