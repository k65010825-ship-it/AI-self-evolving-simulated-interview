/** Real Pi SDK + a deterministic LOCAL provider. No live model quality is tested. */
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AssistantMessage, CredentialStore, TranscriptContext } from '@earendil-works/pi-ai';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { createIsolatedPiSession } from '../../apps/agent/src/adapters/pi/session-factory.ts';
import { ToolReceiptSchema } from '../../packages/contracts/src/tools.ts';

const emptyCredentials: CredentialStore = {
  read: async () => undefined,
  list: async () => [],
  modify: async () => { throw new Error('Offline credential writes are forbidden'); },
  delete: async () => { throw new Error('Offline credential writes are forbidden'); },
};

function assistant(content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason']): AssistantMessage {
  return {
    role: 'assistant', content, api: 'openai-completions', provider: 'offline-fixture',
    model: 'fixture', stopReason, timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

export async function runOfflineSpike() {
  const cwd = await mkdtemp(join(tmpdir(), 'interview-pi-'));
  const runtime = await ModelRuntime.create({
    credentials: emptyCredentials, modelsPath: null,
    allowModelNetwork: false, refreshOnCreate: false,
  });
  let providerCalls = 0;
  let toolCalls = 0;
  let cancellationRequested = false;
  let announceBlocked!: () => void;
  const blocked = new Promise<void>((resolve) => { announceBlocked = resolve; });
  runtime.registerProvider('offline-fixture', {
    api: 'openai-completions', apiKey: 'offline-fixture-not-a-secret',
    baseUrl: 'http://127.0.0.1:1/not-used',
    models: [{ id: 'fixture', name: 'Offline fixture', reasoning: false, input: ['text'],
      contextWindow: 8192, maxTokens: 512,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: (_model, context: TranscriptContext, options) => {
      providerCalls++;
      const stream = createAssistantMessageEventStream();
      if (cancellationRequested) {
        const aborted = () => {
          const message = assistant([], 'aborted');
          stream.push({ type: 'error', reason: 'aborted', error: message });
        };
        if (options?.signal?.aborted) aborted();
        else options?.signal?.addEventListener('abort', aborted, { once: true });
        announceBlocked();
      } else {
        queueMicrotask(() => {
          const hasToolResult = context.messages.some((message) => message.role === 'toolResult');
          const message = hasToolResult
            ? assistant([{ type: 'text', text: '请解释 Spring 事务代理边界。' }], 'stop')
            : assistant([{ type: 'toolCall', id: 'fixture-call-1', name: 'query_role_knowledge',
              arguments: { roleId: 'java-backend', skillId: 'spring-transactions', purpose: 'questioning' } }], 'toolUse');
          stream.push({ type: 'start', partial: message });
          if (hasToolResult) stream.push({ type: 'text_delta', contentIndex: 0,
            delta: '请解释 Spring 事务代理边界。', partial: message });
          stream.push({ type: 'done', reason: hasToolResult ? 'stop' : 'toolUse', message });
        });
      }
      return stream;
    },
  });
  const model = runtime.getModel('offline-fixture', 'fixture');
  assert.ok(model);
  const manager = SessionManager.inMemory(cwd);
  const { session } = await createIsolatedPiSession({
    cwd, modelRuntime: runtime, model, sessionManager: manager,
    context: { userId: 'offline-student', runId: 'offline-run', attemptId: 'attempt-1',
      roleId: 'java-backend', deadlineAt: Date.now() + 60000 },
  });
  const events: string[] = [];
  let abortedSettled = false;
  const unsubscribe = session.subscribe((event) => {
    events.push(event.type);
    if (event.type === 'tool_execution_end') {
      const receipt = ToolReceiptSchema.parse(event.result.details);
      assert.equal(receipt.data?.items[0]?.id, 'java-scenario-transactions');
      toolCalls++;
    }
    if (event.type === 'agent_settled' && event.aborted) abortedSettled = true;
  });
  try {
    assert.deepEqual(session.getActiveToolNames(), ['query_role_knowledge']);
    assert.deepEqual(session.getCallableToolNames(), ['query_role_knowledge']);
    assert.equal(session.sessionFile, undefined);
    await session.prompt('请依据岗位知识给出一道题。');
    await session.waitForIdle();
    assert.equal(toolCalls, 1);
    assert.ok(events.includes('tool_execution_start'));
    assert.ok(events.includes('tool_execution_end'));
    assert.ok(events.includes('message_end'));
    assert.ok(events.includes('agent_settled'));
    assert.match(session.getLastAssistantText() ?? '', /事务代理/);
    const entries = manager.getEntries();
    const restored = SessionManager.inMemory(cwd, undefined, [manager.getHeader()!, ...entries]);
    assert.equal(restored.buildSessionContext().messages.length, manager.buildSessionContext().messages.length);
    cancellationRequested = true;
    const pending = session.prompt('等待直到取消。');
    await blocked;
    await session.abort();
    await pending;
    await session.waitForIdle();
    assert.ok(abortedSettled);
    return { sdkVersion: '1.4.0', runtime: process.versions.bun ? 'bun' : 'node',
      provider: 'deterministic-local-fixture', liveModelCalls: 0, providerCalls, toolCalls,
      toolIsolation: true, resourcesIsolated: true, sdkHistoryRestored: true,
      toolEvents: true, settledEvent: true, cancellation: true,
      notVerified: ['real-provider-auth', 'model-tool-choice-quality', 'provider-network-cancellation', 'live-token-cost'] };
  } finally {
    unsubscribe();
    session.dispose();
    const resolvedCwd = await realpath(cwd);
    const resolvedTemp = await realpath(tmpdir());
    assert.ok(resolvedCwd.startsWith(resolvedTemp + sep) && basename(resolvedCwd).startsWith('interview-pi-'));
    await rm(resolvedCwd, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await runOfflineSpike(), null, 2));
}
