import { writeFile } from 'node:fs/promises';
import { stringify } from 'yaml';
import { z } from 'zod';
import { KnowledgeQuerySchema, ToolReceiptSchema } from '../packages/contracts/src/tools.ts';
const problemRef = { $ref: '#/components/responses/Problem' };
const planned = (operationId: string, summary: string, targetStatus: number, parameters: unknown[] = []) => ({
  operationId, summary, description: '设计契约。当前骨架返回 501；目标状态由 x-target-status 记录，不代表已实现。',
  'x-implementation': 'planned', 'x-target-status': targetStatus,
  security: [{ BearerAuth: [] }], parameters,
  responses: { [String(targetStatus)]: { description: '目标成功响应；尚未实现，当前骨架实际返回 501。' },
    '501': problemRef, '401': problemRef, '403': problemRef, '422': problemRef, '429': problemRef },
});
const id = (name: string) => ({ name, in: 'path', required: true, schema: { type: 'string', minLength: 1 } });
const pagination = [{ name: 'cursor', in: 'query', schema: { type: 'string' } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }];
const paths: Record<string, unknown> = {
  '/health': { get: { operationId: 'getHealth', summary: '读取骨架健康状态', security: [],
    responses: { '200': { description: '当前仅 scaffold，模型未配置。', content: { 'application/json': {
      schema: { $ref: '#/components/schemas/Health' } } } }, '500': problemRef } } },
  '/v1/roles': { get: planned('listRoles', '岗位清单', 200, pagination) },
  '/v1/interviews': {
    get: planned('listInterviews', '当前用户面试记录', 200, pagination),
    post: { ...planned('createInterview', '创建面试', 201), requestBody: { required: true,
      content: { 'application/json': { schema: { type: 'object', additionalProperties: false,
        required: ['roleId', 'goal', 'durationMinutes'], properties: {
          roleId: { type: 'string', enum: ['java-backend', 'web-frontend'] }, goal: { type: 'string', minLength: 1, maxLength: 500 },
          durationMinutes: { type: 'integer', minimum: 15, maximum: 25 } } } } } } },
  },
  '/v1/interviews/{interviewId}': { get: planned('getInterview', '查询本人面试状态', 200, [id('interviewId')]) },
  '/v1/interviews/{interviewId}/answers': { post: {
    ...planned('submitAnswer', '幂等提交回答', 202, [id('interviewId'),
      { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 1, maxLength: 128 } }]),
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false,
      required: ['sessionVersion', 'answer'], properties: { sessionVersion: { type: 'integer', minimum: 0 },
        answer: { type: 'string', minLength: 1, maxLength: 10000 } } } } } },
  } },
  '/v1/interviews/{interviewId}/report': { get: planned('getReport', '读取本人报告', 200, [id('interviewId')]) },
  '/v1/runs/{runId}': { get: planned('getRun', '查询运行快照', 200, [id('runId')]) },
  '/v1/runs/{runId}/events': { get: planned('subscribeRun', '订阅归一 SSE 事件', 200, [id('runId'),
    { name: 'Last-Event-ID', in: 'header', schema: { type: 'string' } }]) },
  '/v1/runs/{runId}/cancellation': { post: planned('cancelRun', '取消运行并撤销提交资格', 202, [id('runId')]) },
  '/v1/profiles/me': { get: planned('getOwnProfile', '本人能力画像', 200) },
  '/v1/experiments': { post: planned('createExperiment', '管理员创建评测任务', 202), get: planned('listExperiments', '管理员评测记录', 200, pagination) },
};
const document = {
  openapi: '3.1.0', info: { title: 'Interview Agent Workbench API', version: '0.1.0',
    description: '仅 /health 已实现。其余为规划契约，当前返回 501；错误码详见 error-handling.md。',
    license: { name: 'Private project; licensing not yet declared' } },
  servers: [{ url: 'http://127.0.0.1:3100', description: '本地开发 API，生产必须 HTTPS' }], paths,
  components: {
    securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer', description: '正式认证尚未实现；会话撤销与归属检查由 API 负责。' } },
    schemas: {
      Health: { type: 'object', additionalProperties: false, required: ['service', 'stage', 'liveModelConfigured', 'capabilities'],
        properties: { service: { type: 'string', enum: ['api', 'agent'] }, stage: { const: 'scaffold' },
          liveModelConfigured: { const: false }, capabilities: { type: 'array', items: { type: 'string' } } } },
      Problem: { type: 'object', required: ['type', 'title', 'status', 'code', 'detail', 'requestId', 'retryable'],
        properties: { type: { type: 'string', format: 'uri' }, title: { type: 'string' }, status: { type: 'integer' },
          code: { type: 'string' }, detail: { type: 'string' }, requestId: { type: 'string' }, retryable: { type: 'boolean' } } },
    },
    responses: { Problem: { description: '结构化公开错误，未实现能力为 NOT_IMPLEMENTED。',
      content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' },
        example: { type: 'urn:interview:error:not-implemented', title: 'NOT_IMPLEMENTED', status: 501,
          code: 'NOT_IMPLEMENTED', detail: '该能力尚未实现，当前为开发骨架。', requestId: 'request-example', retryable: false } } } } },
  },
};
await writeFile(new URL('../docs/openapi.yaml', import.meta.url), stringify(document));
await writeFile(new URL('../docs/tool-schemas.json', import.meta.url), JSON.stringify({
  version: 1, query_role_knowledge: { input: z.toJSONSchema(KnowledgeQuerySchema, { io: 'input' }),
    output: z.toJSONSchema(ToolReceiptSchema) },
}, null, 2) + '\n');
console.log('Generated docs/openapi.yaml from explicit API design and public Zod contracts.');
