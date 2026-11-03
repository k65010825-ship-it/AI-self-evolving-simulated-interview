import { createOfflineRunManager } from '../../apps/agent/src/runtime/offline-runtime.ts';
import { createMemory } from '../../apps/agent/src/memory/session-memory.ts';
import { AgentRunRequestSchema, type AgentRunRequest } from '../../packages/contracts/src/agent-run.ts';
import { createWorkflowCommitTicket } from '../../packages/agent-client/src/workflow-commit.ts';
import type { RoleId } from '../../packages/contracts/src/tools.ts';
export async function commitSource(roleId: RoleId = 'java-backend') {
  const now = Date.now(), identity = { userId: 'commit-fixture', roleId }, memory = createMemory(identity, now);
  const request = AgentRunRequestSchema.parse({ inputSnapshotId: 'create-input', context: { ...identity, runId: `create-${roleId}`, attemptId: 'a', deadlineAt: now + 60000 },
    job: { type: 'workflow', operation: { action: 'create', config: { identity, session: { sessionId: `commit-${roleId}`, roleId, durationMinutes: 20,
      skills: [{ skillId: 'project-design', relevance: 1 }, { skillId: 'collaboration', relevance: .99 }] },
      memory, policy: { id: 'commit-policy', roleId, parameters: { maxFollowupDepth: 0, maxTurns: 2, wrapUpSeconds: 30 } },
      goal: '提交联调', skillLabels: { 'project-design': '项目', collaboration: '沟通' }, allowDraftKnowledge: true, now } } } });
  const runtime = await createOfflineRunManager({ planning: 'pi-knowledge' });
  const execute = async (r: AgentRunRequest) => { runtime.start(r); await runtime.wait(r.context.runId); return runtime.snapshot(r.context.runId); };
  const run = await execute(request), current = { session: null, memory };
  const ticket = createWorkflowCommitTicket({ identity, request, operationId: 'operation-create', taskId: 'task-create', leaseVersion: 1,
    expectedStorageVersion: null, expectedMemoryVersion: 0, issuedAt: now, leaseUntil: now + 60000 });
  return { identity, request, run, current, ticket, runtime, execute };
}
