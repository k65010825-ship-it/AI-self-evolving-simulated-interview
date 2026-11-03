# Agent 内部运行入口

本模块连接单轮评估、状态更新、选题和内容报告。业务 API 负责学生身份、会话归属、正式输入快照、任务租约、数据库事务与版本提交。Agent 返回**未提交候选**，不能把内部完成事件直接当作学生侧正式成功。

## 启用与验证

默认 `AGENT_MODE=scaffold`，仅健康检查，内部路径返回 501。显式开启本地 SDK 替身：

```powershell
$env:AGENT_MODE='offline-fixture'
$env:AGENT_INTERNAL_TOKEN=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
bun run dev:agent
```

token 必须由服务部署方提供，32—256 位字母、数字、下划线或连字符。不要把它传给 renderer 或写入日志。进程只监听本机地址；跨主机部署仍需私网与 TLS 配置。

`bun run agent:runtime:demo` 在随机本机端口依次演示 Java 后端、Web 前端的 HTTP 接受任务、SSE 事件、快照和候选报告。使用真实 Pi SDK、本地确定性 provider，`liveModelCalls=0`，草案知识须显式允许。这验证通信和流程，不验证模型评分质量。

## 接口

job.type=workflow可执行完整会话的create/plan/answer/finish/restore，沿用同一鉴权/SSE/取消/幂等机制，结果为未提交会话候选，见 [会话HTTP联调](workflow-http.md)。

AGENT_PLANNING_MODE=pi-knowledge可显式启用模型知识规划，默认deterministic。内部turn结果新增可选planning回执，SSE不变，详见 [知识规划](knowledge-planner.md)。

所有下列接口要求 `Authorization: Bearer <AGENT_INTERNAL_TOKEN>`。机器契约见 [内部 OpenAPI](agent-openapi.yaml)、[JSON Schema](agent-runtime-schemas.json)，跨服务真值是 `packages/contracts/src/agent-run.ts`。Zod 的跨字段校验无法全部表达为 JSON Schema，服务端仍会检查 context 一致、报告用户/岗位等约束。

| 方法 | 路径 | 请求/响应 |
| --- | --- | --- |
| POST | /internal/v1/runs | AgentRunRequest → 202 AgentRunSnapshot |
| GET | /internal/v1/runs/{runId} | 200 AgentRunSnapshot |
| GET | /internal/v1/runs/{runId}/events | 200 text/event-stream |
| POST | /internal/v1/runs/{runId}/cancellation | `{ "attemptId": "当前 attempt" }` → 202 快照 |

AgentRunRequest 包含 inputSnapshotId、宿主 context（userId/runId/attemptId/roleId/deadlineAt）和 job。`job.type=turn` 提供 TurnInput、选题 knowledge、askedQuestionIds、allowDraftKnowledge（默认 false）；`job.type=report` 提供完整 ReportInput。单轮内外 context 必须一致；报告只能包含当前用户对应岗位的记录。评分 rubric、知识及用户身份均由可信宿主提供，不能直接照抄学生请求。

turn 结果为 `{kind:'uncommitted-turn-result',proposal,selection}`；report 结果为 `{kind:'uncommitted-report-result',report}`。内部快照含评分依据，**不得不经裁剪直接返回学生端**。API 应核对任务租约、attempt、session/version 和策略 pin，再用事务/CAS 提交。正式公共 `/v1/*` 业务接口依旧 501，尚无 HTTP 提交实现。

## 事件、重放与取消

每条事件都有 schemaVersion=1、runId、attemptId、seq、occurredAt、type、payload。seq 从 1 递增。支持 run.accepted、run.stage、question.completed、run.completed、run.failed、run.cancelled。run.completed 固定 committed=false，仅含 resultKind；完整候选从内部快照读取。question.completed 只包含题目，不含 rubric；无虚构 question.delta、模型思考或原始 SDK 日志。

`Last-Event-ID: 2` 或 `?afterSeq=2` 重放 seq>2 并持续订阅；两者同时存在须值相同。未知查询参数、重复 cursor 或非规范整数返回 422，超过已知序号返回 409。任务终态且存量事件发送完成后关闭 SSE。断开 SSE 只退订，任务继续；显式取消才会中止执行。

取消必须匹配当前 attempt。取消或超时之后，即使模型忽略 AbortSignal 并返回迟到结果，也不能发布完成事件或改变终态。取消已完成任务仍返回 completed，不能撤销已生成候选；API 对正式提交资格的撤销需要独立持久控制。

## 内存边界与调度

默认最多保留 32 个运行记录、同时接受 4 个未结束任务；不排队扩容、不自动清理，满后返回 429。请求体最多 2 MiB。单次工作上限 30 秒，且不能超过宿主 deadline；评估器自身还有更小的输入/输出预算与超时。相同 runId 仅支持一个 attempt；相同 schema 归一化内容重试返回既有快照，不重复调用模型，改变内容或 attempt 返回 409。

重启会丢失任务、事件、候选和幂等记录。本实现不承诺跨进程重放、恢复、持久重试、分布式并发或生产可用性。达到容量后由开发进程重启清空，业务 API 必须保留正式状态并决定新 runId 的重试策略。宿主在会话开始时固定的 planningPolicy 同时传给评估编排和下一题选择，避免两者使用不同追问深度。

错误来自统一目录：401 服务认证失败，404 运行不存在，409 输入/attempt/游标冲突，413 大小超限，422 输入无效，429 容量满，503 manager 已释放，504 deadline 超时。运行期间失败写入失败快照与 run.failed；不透出供应商原始异常。健康检查 stage=offline-runtime 只表示该离线入口已启用，不检查数据库、真实模型或语音。

## 已确认语音候选

内部turn任务的input新增可选speech，结构为SpeechAnswer；宿主仍需同时提供answer，二者ID/正文必须一致。只传已有确认候选，不传音频字节、不触发ASR调用。评分前校验源用户/岗位、确认时间、原文描述与候选副本，模型只看到确认后的answer.text。report任务随原TurnInput重验，并按answer生成audio_descriptions；SSE事件形状不变，原始转写和音频材料不进入事件。仍是未提交候选，详情见 [语音联动契约](speech.md#运行入口与报告联动)。
