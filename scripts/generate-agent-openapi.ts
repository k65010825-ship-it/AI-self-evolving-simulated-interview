import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { stringify } from 'yaml';
import { AgentRunRequestSchema, AgentRunSnapshotSchema, AgentRunEventSchema, AgentRunCancelSchema, AgentRunResultSchema } from '../packages/contracts/src/agent-run.ts';

const schemas = {
  AgentRunRequest: z.toJSONSchema(AgentRunRequestSchema, { io: 'input' }),
  AgentRunSnapshot: z.toJSONSchema(AgentRunSnapshotSchema),
  AgentRunEvent: z.toJSONSchema(AgentRunEventSchema),
  AgentRunCancel: z.toJSONSchema(AgentRunCancelSchema),
  AgentRunResult: z.toJSONSchema(AgentRunResultSchema),
};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
// Preserve named references in OpenAPI; the standalone JSON file stays fully expanded.
const openapiSchemas = structuredClone(schemas);
Object.assign(openapiSchemas.AgentRunSnapshot.properties!.result!, { anyOf: [ref('AgentRunResult'), { type: 'null' }] });
const problem = { description: '静态错误目录中的 application/problem+json；不透出供应商原始错误。',
  content: { 'application/problem+json': { schema: { type: 'object', required: ['code', 'status', 'detail'],
    properties: { code: { type: 'string' }, status: { type: 'integer' }, detail: { type: 'string' } } } } } };
const json = (name: string) => ({ 'application/json': { schema: ref(name) } });
const body = (name: string) => ({ required: true, content: json(name) });
const runId = { name: 'runId', in: 'path', required: true, schema: { type: 'string', minLength: 1 } };
const errors = { '401': problem, '404': problem, '409': problem, '413': problem, '422': problem, '429': problem, '500': problem, '503': problem, '504': problem };
await writeFile(new URL('../docs/agent-openapi.yaml', import.meta.url), stringify({
  openapi: '3.1.0', info: { title: 'Internal Offline Agent Runtime', version: '0.1.0',
    description: '仅显式 offline-fixture 模式开放。单进程内存任务，返回未提交候选；正式 API 仍待实现。' },
  servers: [{ url: 'http://127.0.0.1:3200' }], security: [{ ServiceToken: [] }],
  paths: {
    '/internal/v1/runs': { post: { operationId: 'startInternalRun', summary: '接受候选生成任务', requestBody: body('AgentRunRequest'),
      description: '支持turn/report/workflow/rsi。rsi验证完整收尾并返回离线实验候选及下一场pin预览，不发布正式策略。workflow含create/plan/answer/finish/restore，根context绑定身份及内嵌run/attempt。请求最多2MiB；202后仍须查询终态，不代表正式提交。',
      responses: { '202': { description: '已接受或返回同内容的既有任务；不代表正式提交。', content: json('AgentRunSnapshot') }, ...errors } } },
    '/internal/v1/runs/{runId}': { get: { operationId: 'getInternalRun', summary: '读取内存快照', parameters: [runId],
      responses: { '200': { description: '候选快照，仅内部服务可读。', content: json('AgentRunSnapshot') }, ...errors } } },
    '/internal/v1/runs/{runId}/cancellation': { post: { operationId: 'cancelInternalRun', summary: '取消当前 attempt', parameters: [runId],
      requestBody: body('AgentRunCancel'), responses: { '202': { description: '返回取消后的快照；已结束任务不反转。', content: json('AgentRunSnapshot') }, ...errors } } },
    '/internal/v1/runs/{runId}/events': { get: { operationId: 'subscribeInternalRun', summary: '订阅或重放内部 SSE',
      description: 'data 为 AgentRunEvent JSON；id 为 seq。两个 cursor 同时存在必须相等，不能超过已有序号。断开订阅不取消任务。',
      parameters: [runId, { name: 'afterSeq', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 999999999 } },
        { name: 'Last-Event-ID', in: 'header', schema: { type: 'string', pattern: '^(0|[1-9]\\d{0,8})$' } }],
      responses: { '200': { description: '完整已校验产品事件；终态后关闭。没有模型原始 token 或正式提交事件。',
        content: { 'text/event-stream': { schema: { type: 'string' }, 'x-event-schema': ref('AgentRunEvent') } } }, ...errors } } },
  },
  components: { securitySchemes: { ServiceToken: { type: 'http', scheme: 'bearer', description: '32—256 位字母数字下划线连字符；服务鉴权，不是学生登录。' } }, schemas: openapiSchemas },
}));
await writeFile(new URL('../docs/agent-runtime-schemas.json', import.meta.url), JSON.stringify({ version: 1, ...schemas }, null, 2) + '\n');
console.log('Generated internal Agent runtime OpenAPI and schemas.');
