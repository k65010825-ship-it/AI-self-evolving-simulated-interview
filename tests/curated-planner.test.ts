import { test, expect } from 'bun:test';
import { runCuratedKnowledgeDemo } from '../scripts/demo-curated-knowledge.ts';
import { ToolReceiptSchema } from '../packages/contracts/src/tools.ts';
test('real Pi SDK tools query the expanded draft bank only with host preview opt-in in both roles', async () => {
  for (const role of ['java-backend', 'web-frontend'] as const) {
    const r = await runCuratedKnowledgeDemo(role);
    expect(r.preview.selection.status).toBe('selected');
    if (r.preview.selection.status !== 'selected') throw new Error('Expected selection');
    expect(r.preview.selection.source.reviewStatus).toBe('draft');
    expect(r.preview.selection.question.id).toBe(role === 'java-backend' ? 'java-technical-atomic-counter' : 'web-technical-microtask-order');
    expect(r.closed.selection.status).toBe('unavailable');
    expect(r.preview.receipts[0]!.data!.guidance![0]!.answerGuide).toBeUndefined();
    expect(r.liveModelCalls).toBe(0);
    const corrupted = structuredClone(r.preview.receipts[0]!);
    corrupted.data!.guidance![0]!.itemId = 'foreign';
    expect(ToolReceiptSchema.safeParse(corrupted).success).toBe(false);
  }
}, 15000);
