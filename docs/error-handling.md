# 错误、取消与恢复契约 v1

HTTP 错误使用 application/problem+json：type（稳定 URN）、title、status、code、detail（可公开摘要）、requestId、retryable。不返回 stack、供应商原文、key、SQL 或内部路径。所有集合接口未来使用 cursor/limit，默认 20、最大 100。

| code | HTTP | 可重试 | 行为 |
| --- | --- | --- | --- |
| VALIDATION_ERROR | 422 | 否 | 指出输入不合法；不回显敏感字段 |
| UNAUTHENTICATED | 401 | 否 | 要求重新登录；不后台循环刷新失败凭证 |
| ROLE_FORBIDDEN / FORBIDDEN | 403 | 否 | 停止该访问，禁止跨岗/跨用户兜底 |
| NOT_FOUND | 404 | 否 | 资源不存在或不可见 |
| VERSION_CONFLICT | 409 | 否 | 获取正式状态，由用户/应用决定后续 |
| RUN_CANCELLED | 409 | 否 | 已撤销提交资格，不接受迟到结果 |
| TOOL_BUDGET_EXCEEDED | 429 | 否 | 本次运行预算耗尽，不换工具绕过 |
| RATE_LIMITED | 429 | 是 | Retry-After；统一调度器在总预算内处理 |
| DEPENDENCY_UNAVAILABLE | 503 | 是 | 只读依赖有限重试、退避，记录 attempt |
| DEADLINE_EXCEEDED | 504 | 否 | 当前 run 期限耗尽，终止继续调用 |
| MODEL_OUTPUT_INVALID | 502 | 是 | 最多一次 schema 修复，计入总调用预算 |
| NOT_IMPLEMENTED | 501 | 否 | 骨架能力尚未实现，不返回虚构业务数据 |
| INTERNAL_ERROR | 500 | 否 | 公开通用摘要，带 requestId，服务端记录脱敏诊断 |

工具回执与 HTTP 使用同一 code catalog，但工具返回结构化 status/error，不把 HTTP code 当成模型可随意恢复的授权。query empty 是正常 empty，不使用异常触发全网搜索。

## 统一预算与结果资格

Pi SDK retry/compaction 首版关闭。业务 run 最多两次任务尝试，每次最多三次 LLM 请求（含输出修复）、五次工具、120 秒；语音服务另设有界任务预算。只能由任务执行器统一重试，SDK/HTTP client/工具不得叠加无界重试。

HTTP 超时不保证远端没执行。API 用 run/attempt/sessionVersion/租约控制正式提交；无法确认外部副作用的未来写工具返回 unknown 并人工/业务核对，不自动重做。已实现种子工具只读，未实现数据库事务不得声称业务恰好一次。

取消先记录业务取消并撤销 attempt 提交资格，然后传递 AbortSignal 并 await Pi abort。agent_settled 只是 SDK 停止自动继续，不等于输出有效；成功需最终 schema、证据、权限与提交资格均通过。客户端退出/断流不取消任务；重连读正式快照，持久事件按序号补齐，临时 delta 可丢失。

## 骨架行为

当前 /health 返回 stage=scaffold、能力列表和 liveModelConfigured=false。/v1 或 /internal/v1 下未实现能力统一 501；未知路径 404。没有登录/模型/数据库时绝不返回“面试完成”。error→HTTP 公开映射使用固定说明，不信任任意 Error.message。
