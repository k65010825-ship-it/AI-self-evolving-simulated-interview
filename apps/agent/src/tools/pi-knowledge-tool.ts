import { z } from 'zod';
import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { KnowledgeQuerySchema, type ToolContext } from '../../../../packages/contracts/src/tools.ts';
import { createKnowledgeExecutor } from './knowledge-executor.ts';

export function createPiKnowledgeTool(context: ToolContext): ToolDefinition {
  const execute = createKnowledgeExecutor(context);
  return {
    name: 'query_role_knowledge', label: '岗位知识查询',
    description: 'Read current-role development seed knowledge. Draft results require review before production use.',
    parameters: Type.Unsafe(z.toJSONSchema(KnowledgeQuerySchema, { io: 'input' })),
    execute: async (callId, params, signal) => {
      const receipt = await execute(callId, params, signal);
      return { content: [{ type: 'text', text: JSON.stringify(receipt) }], details: receipt };
    },
  };
}
