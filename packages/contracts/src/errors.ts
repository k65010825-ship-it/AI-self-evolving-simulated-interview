import type { ErrorCode } from './tools.ts';
const catalog = {
  VALIDATION_ERROR: [422, '输入不符合契约。', false], UNAUTHENTICATED: [401, '请重新登录。', false],
  FORBIDDEN: [403, '没有访问该资源的权限。', false], ROLE_FORBIDDEN: [403, '不能访问当前面试岗位之外的知识。', false],
  NOT_FOUND: [404, '资源不存在。', false], VERSION_CONFLICT: [409, '状态已经变化，请刷新。', false],
  RUN_CANCELLED: [409, '本次运行已取消。', false], TOOL_BUDGET_EXCEEDED: [429, '本次运行的工具预算已用完。', false],
  RATE_LIMITED: [429, '请求过于频繁，请稍后再试。', true], DEPENDENCY_UNAVAILABLE: [503, '依赖服务暂不可用。', true],
  DEADLINE_EXCEEDED: [504, '本次运行已超时。', false], MODEL_OUTPUT_INVALID: [502, '模型结果不符合输出契约。', true],
  NOT_IMPLEMENTED: [501, '该能力尚未实现，当前为开发骨架。', false], INTERNAL_ERROR: [500, '服务处理失败，请凭请求编号排查。', false],
} as const satisfies Record<ErrorCode, readonly [number, string, boolean]>;
export function describeError(code: ErrorCode) {
  const [status, message, retryable] = catalog[code]; return { code, status, message, retryable };
}
export function toProblem(code: ErrorCode, requestId: string) {
  const info = describeError(code);
  return { type: `urn:interview:error:${code.toLowerCase().replaceAll('_', '-')}`,
    title: code, status: info.status, code, detail: info.message, requestId, retryable: info.retryable };
}
