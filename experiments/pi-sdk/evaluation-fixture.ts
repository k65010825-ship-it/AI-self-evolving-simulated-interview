/** Local SDK provider only: no network, stored credentials or model quality claims. */
import type { AssistantMessage, CredentialStore, TranscriptContext } from '@earendil-works/pi-ai';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
export const fixtureAssessment = { evidence: [{ id: 'e1', start: 0, end: 4, excerpt: '事务边界' }],
  criterionScores: [{ criterionId: 'correctness', score: 4, evidenceIds: ['e1'] }],
  feedback: { strengths: ['提及事务边界'], improvements: ['补充失败恢复条件'] } };
type Reply = { text: string; stopReason?: 'stop' | 'length' | 'toolUse';
  toolCalls?:Extract<AssistantMessage['content'][number],{type:'toolCall'}>[] };
export async function createEvaluationFixture(handler: (context: TranscriptContext, signal?: AbortSignal) => Reply | Promise<Reply>
  = () => ({ text: JSON.stringify(fixtureAssessment) })) {
  const credentials: CredentialStore = { read: async () => undefined, list: async () => [],
    modify: async () => { throw new Error('No fixture credential writes'); }, delete: async () => {} };
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const stats = { providerCalls: 0, liveModelCalls: 0, aborted: 0 };
  runtime.registerProvider('evaluation-fixture', { api: 'openai-completions', apiKey: 'local-not-a-secret',
    baseUrl: 'http://127.0.0.1:1/not-used', models: [{ id: 'fixture', name: 'Evaluation fixture', reasoning: false,
      input: ['text'], contextWindow: 32768, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: (_model, context, options) => {
      stats.providerCalls++;
      const stream = createAssistantMessageEventStream(); let finished = false;
      const message = (content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason']): AssistantMessage => ({
        role: 'assistant', content, stopReason, api: 'openai-completions', provider: 'evaluation-fixture', model: 'fixture', timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
      const abort = () => {
        if (finished) return; finished = true; stats.aborted++;
        options?.signal?.removeEventListener('abort', abort);
        stream.push({ type: 'error', reason: 'aborted', error: message([], 'aborted') });
      };
      options?.signal?.addEventListener('abort', abort, { once: true });
      if (options?.signal?.aborted) abort();
      else void Promise.resolve().then(() => handler(context, options?.signal)).then(reply => {
        if (finished) return; finished = true; options?.signal?.removeEventListener('abort', abort);
        const reason = reply.stopReason ?? 'stop';
        const result = message(reason === 'toolUse' ? (reply.toolCalls??[{ type: 'toolCall', id: 'forbidden-call', name: 'read', arguments: { path: 'secret' } }])
          : [{ type: 'text', text: reply.text }], reason);
        stream.push({ type: 'start', partial: result });
        stream.push({ type: 'done', reason, message: result });
      }).catch(() => {
        if (finished) return; finished = true; options?.signal?.removeEventListener('abort', abort);
        stream.push({ type: 'error', reason: 'error', error: message([], 'error') });
      });
      return stream;
    } });
  const model = runtime.getModel('evaluation-fixture', 'fixture');
  if (!model) throw new Error('Fixture registration failed');
  return { runtime, model, stats };
}
