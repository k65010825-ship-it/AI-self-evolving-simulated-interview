import { pathToFileURL } from 'node:url';
import { createEvaluationFixture } from '../experiments/pi-sdk/evaluation-fixture.ts';
import { contentText } from '../experiments/pi-sdk/planner-fixture.ts';
import { createPiQuestionPlanner } from '../apps/agent/src/adapters/pi/question-planner.ts';
import { createInterviewState } from '../apps/agent/src/planning/interview-state.ts';
import type { RoleId } from '../packages/contracts/src/tools.ts';

export async function runCuratedKnowledgeDemo(roleId: RoleId = 'java-backend') {
  const skillId = roleId === 'java-backend' ? 'java-concurrency' : 'javascript';
  const query = roleId === 'java-backend' ? 'AtomicInteger.incrementAndGet' : 'Promise.then';
  const fixture = await createEvaluationFixture(context => {
    const last = context.messages.filter(m => m.role === 'toolResult').at(-1);
    if (last) {
      const receipt = JSON.parse(contentText(last.content));
      return { text: JSON.stringify({ questionId: receipt.data?.items[0]?.id ?? null }) };
    }
    return { text: '', stopReason: 'toolUse', toolCalls: [{ type: 'toolCall', id: 'curated-query', name: 'query_role_knowledge', arguments: { skillId, query, limit: 1 } }] };
  });
  const now = Date.now(), state = createInterviewState({ sessionId: `curated-${roleId}`, roleId, durationMinutes: 20,
    skills: [{ skillId, relevance: 1 }] }, now);
  const input = { context: { userId: 'curated-fixture', roleId, runId: 'curated', attemptId: 'a', deadlineAt: now + 60000 },
    state, goal: '验证扩充知识工具链路', askedQuestionIds: [], allowDraftKnowledge: true };
  const make = (knowledgeMode: 'reviewed-only' | 'draft-preview') => createPiQuestionPlanner({ cwd: process.cwd(),
    modelRuntime: fixture.runtime, model: fixture.model, knowledgeMode });
  const preview = await make('draft-preview')(input), closed = await make('reviewed-only')(input);
  return { roleId, preview, closed, liveModelCalls: fixture.stats.liveModelCalls, productionPublished: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const role of ['java-backend', 'web-frontend'] as const) {
    const r = await runCuratedKnowledgeDemo(role);
    console.log(JSON.stringify({ roleId: role, previewStatus: r.preview.selection.status,
      questionId: r.preview.selection.status === 'selected' ? r.preview.selection.question.id : null,
      sourceStatus: r.preview.selection.status === 'selected' ? r.preview.selection.source.reviewStatus : null,
      reviewedOnlyStatus: r.closed.selection.status, toolCalls: r.preview.receipts.length, liveModelCalls: r.liveModelCalls, productionPublished: false }));
  }
}
