import { z } from 'zod';
import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { ResourceQuerySchema } from '../../../../packages/contracts/src/resources.ts';
import { createResourceExecutor } from './resource-executor.ts';
export function createPiResourceTool(context: unknown, catalog: unknown, options: unknown = {}): ToolDefinition {
  const execute = createResourceExecutor(context, catalog, options);
  return { name: 'search_learning_resources', label: '学习资源查询',
    description: 'Search the current role, skill and exact level in the maintained host catalog. Empty means no eligible resource. Never counts as learning completion.',
    parameters: Type.Unsafe(z.toJSONSchema(ResourceQuerySchema, { io: 'input' })), execute: async (callId, params, signal) => {
      const receipt = await execute(callId, params, signal);
      return { content: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt };
    } };
}
