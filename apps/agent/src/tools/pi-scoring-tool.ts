import { z } from 'zod';
import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { ScoringInputSchema } from '../../../../packages/contracts/src/scoring.ts';
import { createScoringExecutor } from './scoring-executor.ts';
/** Explicit opt-in only: the isolated session's default whitelist remains unchanged. */
export function createPiScoringTool(context: unknown, rubrics: unknown): ToolDefinition {
  const execute = createScoringExecutor(context, rubrics);
  return { name: 'compute_rubric_score', label: '内容评分计算',
    description: 'Compute host-rubric technical-content scores from criterion grades and registered answer evidence. Partial coverage is not a full score.',
    parameters: Type.Unsafe(z.toJSONSchema(ScoringInputSchema, { io: 'input' })),
    execute: async (callId, params, signal) => {
      const receipt = await execute(callId, params, signal);
      return { content: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt };
    } };
}
