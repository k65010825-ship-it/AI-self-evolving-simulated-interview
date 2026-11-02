# 接口文档

版本：v1 开发基线。面向前端、业务后端与 Agent 联调。**当前仅 GET /health 可用；所有正式业务接口仍返回 501。** 下文请求约束已在 OpenAPI 中定义；业务成功对象与 SSE payload 是目标约定，实现前须同步到公共 schema 和 OpenAPI。

## 1. 服务与协议

| 服务 | 本地地址 | 使用方 |
| --- | --- | --- |
| 业务 API | http://127.0.0.1:3100 | Electron 主进程 |
| Agent | http://127.0.0.1:3200 | 业务后端，生产不对公网开放 |

生产 API 使用 HTTPS。时间统一 ISO 8601 UTC；标识符为不透明字符串，不依赖前缀解析。普通 JSON 用 application/json，错误用 application/problem+json。私有业务接口目标使用 Authorization: Bearer <token>；不预设 token 必须是 JWT，登录与刷新方案尚未定。当前骨架没有认证实现，不能将健康接口可达当作登录成功。

集合接口约定 cursor、limit（默认 20、范围 1—100），目标响应为 `{ "items": [], "nextCursor": null }`；最后一页 nextCursor=null。

## 2. 当前可用：健康检查

```http
GET /health
```

业务 API 当前返回：

```json
{
  "service": "api",
  "stage": "scaffold",
  "liveModelConfigured": false,
  "capabilities": ["health-only"]
}
```

Agent 的 service 为 agent，capabilities 为 offline-pi-spike、draft-seed-knowledge。此接口不检查真实模型、语音或数据库就绪。

## 3. 目标 HTTP 接口清单

下表“目标成功码”不是当前运行结果；当前统一返回 501。创建/读取实验须管理员权限，学生数据须验证本人归属。

| 方法 | 路径 | 用途 | 目标成功码 |
| --- | --- | --- | --- |
| GET | /v1/roles | 分页岗位清单 | 200 |
| POST | /v1/interviews | 创建面试与初始规划任务 | 201 |
| GET | /v1/interviews | 本人面试列表 | 200 |
| GET | /v1/interviews/{interviewId} | 本人面试快照与当前问题 | 200 |
| POST | /v1/interviews/{interviewId}/answers | 幂等提交回答、创建处理任务 | 202 |
| GET | /v1/interviews/{interviewId}/report | 本人评估报告 | 200 |
| GET | /v1/runs/{runId} | 任务快照 | 200 |
| GET | /v1/runs/{runId}/events | SSE 事件 | 200 |
| POST | /v1/runs/{runId}/cancellation | 取消并撤销提交资格 | 202 |
| GET | /v1/profiles/me | 本人跨会话画像 | 200 |
| POST | /v1/experiments | 创建策略评测任务 | 202 |
| GET | /v1/experiments | 分页实验记录 | 200 |

### 3.1 创建面试

```http
POST /v1/interviews
Authorization: Bearer <token>
Content-Type: application/json

{
  "roleId": "java-backend",
  "goal": "练习事务与并发场景题",
  "durationMinutes": 20
}
```

| 字段 | 约束 |
| --- | --- |
| roleId | 必填，java-backend / web-frontend |
| goal | 必填，1—500 字符 |
| durationMinutes | 必填整数，15—25 |

目标 201 对象为 `{ "interview": Interview, "run": Run }`。初始状态为 planning、queued，currentQuestion=null；计划/首题就绪后会话进入 awaiting_answer。创建成功不等于问题已生成。

### 3.2 提交回答

```http
POST /v1/interviews/interview-demo/answers
Authorization: Bearer <token>
Idempotency-Key: answer-demo-001
Content-Type: application/json

{
  "sessionVersion": 1,
  "answer": "我会先明确数据库事务和缓存更新之间的失败窗口……"
}
```

sessionVersion 为当前快照的非负整数；answer 为 1—10000 字符。Idempotency-Key 必填，长度 1—128。相同键与相同内容返回既有任务；相同键但内容不同、版本落后、未在 awaiting_answer 状态均应 409。

目标返回 202 Run。API 只有在保存回答与创建任务的事务成功后确认接受；客户端通过 Run 与事件获取进度，再刷新面试快照，不能提前把下一题写为正式状态。

语音上传、ASR、转写确认和音频引用的 HTTP 字段尚未冻结：当前 answer 仅文字，不接受假定的 audioId。正式语音接口设计时一起更新本文、OpenAPI 和公共 schema。

### 3.3 取消与报告

取消路径只传 runId，不接受模型/客户端指定 attemptId 来越过权限。目标 202 返回最新 Run；已完成任务保留 completed，取消成功后旧结果不能提交。关闭窗口/断开 SSE 不自动取消任务。

报告未生成时目标返回 409 VERSION_CONFLICT，并通过快照继续查询；无权限 403，不存在/不可见按权限策略返回 404。生成后报告有 reportId、interviewId、roleId、评分/策略版本、各维 score/evidence、亮点/不足、练习和资源建议。无音频维度为 null，不能填零。详细评分对象在报告迭代冻结前不得假装已具备完整机器 schema。

## 4. 目标数据对象

| 对象 | 字段与语义 |
| --- | --- |
| Interview | interviewId、roleId、goal、durationMinutes、status、sessionVersion、policyVersion、currentQuestion（可空）、createdAt |
| Question | questionId、text、skillId、questionType（technical/project/scenario/behavioral）、difficulty（1—5） |
| Run | runId、interviewId、attemptId（可空）、status、stage（可空）、error（Problem 或 null）、lastEventSeq、createdAt |
| Role | roleId、name、skillIds；两岗独立知识和 rubric |
| Profile | 按岗位/技能的 mastery（[0,1] 或 null）、confidence（[0,1]）、证据数/引用、更新时间和版本 |

Interview 状态为 planning、awaiting_answer、processing_answer、completed、cancelled、failed；Run 状态为 queued、running、completed、failed、cancelled。业务数据库 id 到这些 DTO 字段由 API 映射，客户端不直接读取数据库行。

当前已生成 OpenAPI 主要覆盖路径、请求、错误与健康响应；表中的完整业务成功对象尚待实现时补入 schema。更改上表视为契约变更，不由各端各自推测。

## 5. SSE 与重连

```http
GET /v1/runs/run-demo/events
Authorization: Bearer <token>
Last-Event-ID: 7
Accept: text/event-stream
```

目标示例（尚未实现）：

```text
id: 8
event: run.stage
data: {"schemaVersion":1,"runId":"run-demo","attemptId":"attempt-1","seq":8,"type":"run.stage","payload":{"stage":"evaluating","message":"正在评估回答"},"occurredAt":"2026-11-01T12:00:00.000Z"}
```

| 事件 | 目标 payload |
| --- | --- |
| run.accepted | stage=queued |
| run.stage | stage、可公开 message |
| question.delta | questionId、delta（临时展示） |
| question.completed | question（完整 Question） |
| run.completed | interviewId、sessionVersion |
| run.failed | error（公开 Problem） |
| run.cancelled | reason（公开摘要） |

公共 RunEventSchema 已定义 envelope，payload 当前是占位 Record，正式推送前须改为各事件的独立校验。seq 在单 run 内单调递增并跨 attempt 保持顺序；Last-Event-ID 表示最后消费的 seq，必须同时核对 runId。最终快照权威，临时文本 delta 不保证全部重放；seq 缺口时刷新快照，不据此重做回答提交。

Electron main 消费 SSE，preload 只转发产品事件；不把 SDK 原始消息或内部思维内容交给 UI。普通 API JSON 错误与已建立流之后的 run.failed 分开处理。

## 6. Agent 内部接口与工具

Agent 目前仅提供健康接口；/internal/v1/* 返回 501。API→Agent 的 start/stream/cancel 形状由 apps/agent/src/runtime/backend.ts 表达边界，HTTP 鉴权与运行请求体尚未实现。正式接入时须携带可校验的任务引用、内部服务身份和预算，客户端不能直连。

query_role_knowledge 是 SDK 内工具，不是公开 HTTP 查询端点。模型输入 roleId/skillId/purpose/query/limit，执行上下文由宿主注入；详见[工具契约](tool-contracts.md)与[工具 JSON Schema](tool-schemas.json)。

桌面当前暴露的桥接只有 window.interview.getVersion() 与 getApiHealth()；不能调用通用 ipcRenderer、任意 channel 或任意 URL。新增提交/取消/订阅桥接时必须按本文契约单独实现。

## 7. 错误与联调流程

当前未实现路径的真实响应示例：

```json
{
  "type": "urn:interview:error:not-implemented",
  "title": "NOT_IMPLEMENTED",
  "status": 501,
  "code": "NOT_IMPLEMENTED",
  "detail": "该能力尚未实现，当前为开发骨架。",
  "requestId": "opaque-request-id",
  "retryable": false
}
```

错误码、重试和取消规则见[错误处理](error-handling.md)。401/403 不自动换身份重试；409 刷新状态；429 看 code 和 Retry-After；输出修复、工具与任务重试共同受预算约束。

联调顺序：先确认目标状态与字段 → 修改 packages/contracts 与 OpenAPI 生成脚本 → 生成机器文档 → 前后端按相同样例实现 → 验证正常/错误/取消路径。执行 bun run openapi:generate、bun run openapi:lint；不要手改生成后的 YAML/JSON。接口实现后同时更新“当前可用”标记。

待进一步设计：登录/刷新、音频上传与转写、学习资源/完成记录、结束面试、策略审核/回退等 HTTP 端点。它们是产品需求，尚未冻结路径和请求体，不能据界面先假定已可调用=。
