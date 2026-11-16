# 接口文档

## 双端接口导航（当前协作入口）

| 链路 | 契约与入口 | 当前状态 / 归属 |
| --- | --- | --- |
| 桌面面试、报告、记忆、任务、预算、ASR/TTS | [本地 stdio RPC](local-runtime-api.md)，`packages/contracts/src/local-runtime.ts` 及 local-speech/local-live | 实现位于 feature/agent；主进程用 `@interview/local-agent-client`，不经过云端面试 HTTP |
| 页面投影、提示、画像趋势、学习复测、反思/实验查询 | 在本地 RPC 上补契约 | 尚未完整开放；Agent 与后端先定字段、状态、幂等和错误，前端不以原型假数据代替 |
| 统一账号、管理查询/审核、知识/策略分发、授权回传、评测任务 | 管理 HTTPS API，由后端在共享 contracts 定义 | 设计目标，尚无完整可用契约；不能把下方旧试点路由直接视为管理接口 |
| 旧服务面试与 Agent HTTP/SSE | 下方第 1—5 节、openapi.yaml / agent-openapi.yaml | 历史回归协议，完整试点实现在 feature/agent；master 的旧默认入口仍以代码为准 |

**管理 API 不再承担新客户端正式会话的创建/答题/提交。** 用户数据由本地宿主写入；管理端保存账号、团队内容、授权样本副本和实验。SSE 不替代 stdio 事件重放，HTTP requestId 也不替代本地 operationId。

以下管理资源是待设计清单，**不是已实现路径/字段**：账号登录/续期/退出；带版本与摘要的内容包查询/下载；带授权与幂等键的反馈/样本导入；只读指标；审核决定；受预算约束的实验创建/查询/逐例结果。具体路径、响应和错误须后端先提交 contracts。监控查询不得触发模型执行，实验达标不得返回已发布；发布/回退与客户端采用单独设计。

账号/profile 切换由主进程与本地业务层协同实现，renderer 不传任意 profile 路径。学生不得调用 admin 接口，管理端也不得通过客户端通道获取供应商凭证。具体所有权见[架构](architecture.md)，接手顺序见[协作](collaboration.md)。新增方法须先提交 schema 和错误/状态契约，本文导航不代表已有相应运行入口。

---

以下为**旧服务试点接口说明**。仅用于旧链路回归，不是新双端开发的默认入口。

**迁移提示（2026-11-10）**：本文HTTP接口属于旧服务试点，继续用于回归。新客户端文字宿主已采用独立本地运行时＋stdio RPC，schema在`packages/contracts/src/local-runtime.ts`，已实现方法见[本地接口](local-runtime-api.md)。它不需要网页登录、内部服务token或自请求HTTP；本地live文字已采用显式授权/私有凭证代理，完成注入HTTP离线验证；本地ASR确认/TTS已有独立stdio实现并离线注入验证，旧语音HTTP保留回归。

版本0.2。**下述业务接口由 `bun run pilot:start` 启动的SQLite试点实现**；旧 `dev:api` 的业务路径继续返回501。跨服务schema真值为 `packages/contracts`，运行 `bun run openapi:generate` 生成 [OpenAPI](openapi.yaml) 与 workbench-schemas.json。不要使用旧目标接口字段联调新试点。

## 1. 服务与认证

API默认 `http://127.0.0.1:3100`，Agent默认3200；远程API必须HTTPS。学生使用运营者配置账号登录，获得1小时有效的随机不透明Bearer令牌。令牌的客户端保存与界面接线由前端同学负责；当前Agent工作不包含桌面实现。供应商凭证只在Agent进程。内部服务使用独立服务token，不能用学生token调用。

JSON时间为epoch毫秒，正文UTF-8。普通错误统一 `application/problem+json`，包含 code/status/detail/requestId/retryable 等；不透出供应商原始响应或堆栈。JSON32KiB、WAV4MiB，HTTP入口并发8，Agent语音执行并发4；不是多实例全局限流保证。正式会话数据仅允许本人访问。

## 2. 可用业务接口

| 方法与路径 | 请求/响应与行为 |
| --- | --- |
| GET /health | stage=pilot表示试点入口；不是模型/设备可用性探测 |
| POST /v1/auth/login | `{userId,password}` → `{token,expiresAt,user}`；没有学生注册或任意userId授权 |
| POST /v1/auth/logout | 撤销当前令牌 |
| GET /v1/roles | Java后端、Web前端和技能清单 |
| GET /v1/interviews | 本人最近100场 PilotSessionView 数组；尚无分页 |
| POST /v1/interviews | PilotSessionCreate → 202 `{sessionId,operationId}` |
| GET /v1/interviews/{id} | PilotSessionView，包含revision/phase/question/clarification/report |
| POST /v1/interviews/{id}/question | PilotCommand → 202操作ID；按状态选下一题 |
| POST /v1/interviews/{id}/answers | PilotAnswer → 202操作ID；语音需附已确认speechId |
| POST /v1/interviews/{id}/completion | PilotCommand → 202操作ID；生成报告、记忆和反思候选 |
| GET /v1/operations/{id} | running/completed/failed/interrupted与公开errorCode |
| POST /v1/interviews/{id}/speech | PilotSpeechCreate → 201 `{speechId}`；仅登记源，不表示ASR成功 |
| PUT /v1/speech/{id}/audio | audio/wav 原始规范WAV → 202任务视图 |
| GET /v1/speech/{id} | 原转写/确认文/版本/错误/未验证表达观察 |
| POST /v1/speech/{id}/confirmation | `{expectedVersion,text}` → 确认候选；不等于答题提交 |
| POST /v1/speech/{id}/cancellation | 撤销候选资格，不保证供应商停止计费 |
| GET /v1/interviews/{id}/question-audio?questionId=... | 当前正式题目24kHz PCM16 WAV；缓存幂等；离线为提示音 |
| GET /v1/evidence/status | 独立审核和真实队列的初始待验证状态；不是持续更新的审核数据库 |

### 创建与回答示例

```json
{"operationId":"create-001","roleId":"java-backend","goal":"练习事务与项目设计","durationMinutes":20,"pressure":false}
```

创建成功受理后轮询 `/v1/operations/create-001`，完成后读取会话revision，再提交：

```json
{"operationId":"plan-001","expectedRevision":0}
```

回答使用新操作ID和当前revision：

```json
{"operationId":"answer-001","expectedRevision":1,"text":"我会先说明事务边界和异常回滚条件。"}
```

operationId在所有动作间唯一；同ID同内容回放结果，改内容/动作/用户冲突拒绝。并发旧revision不覆盖新状态。完整command字段见 workbench-schemas.json。202只是受理，只有operation completed后，API才已通过提交验证并以SQLite事务原子写正式会话、记忆及唯一回执。Agent结果是未提交候选。

## 3. 语音与澄清

客户端把麦克风重采样为16kHz单声道PCM16 WAV，先登记 `{expectedRevision,sha256,byteLength}`，保存speechId后上传。同ID同字节重传不再次ASR，改字节拒绝；任何查询/确认均校验用户、岗位、当前题目与绑定。录音不自动上传，必须点击确认上传。

转写完成后保留originalText，学生只能编辑确认文本与expectedVersion；提交回答时text须与确认文一致。原始WAV不落业务库，任务与转写候选持久化。确认与正式提交是两个动作。

needs_clarification保留同题，客户端提供原回答前缀和补充；服务端避免重复拼接。abstained记录未评分原因，不写0分或掌握度观测；报告显示覆盖分母、记忆不伪造分数。详见 [完整会话澄清](workflow-clarification.md)。

## 4. Agent内部契约

工作流通过已鉴权 `/internal/v1/runs` 与归一SSE执行；实际JSON定义见 [Agent OpenAPI](agent-openapi.yaml)、[HTTP/SSE说明](workflow-http.md) 与 [客户端SDK](agent-client.md)。内部语音接口见 [speech-tasks.md](speech-tasks.md)。

另有 `POST /internal/v1/speech/synthesis`，请求 QuestionVoiceRequest，API宿主提供canonical当前题目绑定；返回audio/wav。Agent用内部token回调API的 `/internal/v1/voice/authorization` 与 `/internal/v1/speech/authorization`，由正式记录决定授权，模型不能提供或覆盖身份。

预算结算、账单导入只开放给运营者本地CLI，不开放学生HTTP。恢复中的unknown保留预留与并发，不能简单刷新即收费重跑。详见 [统一额度](session-accounting.md)、[持久恢复](durable-runtime.md)。

## 5. 尚未开放的业务能力

Agent内部runs支持 `job.type=closeout-preview` 的只读修订预览与版本选择，具体见[预览契约](closeout-preview.md)；它不能走正式提交，也不意味着下列业务发布接口已开放。

反馈修订目前提供共享宿主函数与离线JSON回放，不提供正式版本选择、审批落库或重新发布路由。必须保留原始turns，通过受检版本链获得 `revisionContext` 再复核，不能把修订候选覆盖正式原答/评分或把旧回执移到新版本。见[反馈修订与回放](feedback-revision.md)。

报告展示读取 `assessments[].feedback` 与 `feedbackPublication`，不要直接显示内部 `turns[].proposal.feedback` 或 SSE 中的完整候选。新建报告会暂缓明确事实冲突和指定待审疑点，业务提交校验重算相同投影；全部暂缓时反馈数组可为空。复核回执目前是宿主函数生成的未提交候选，没有 reviewer 登录、正式回执存储或重新发布 HTTP 路由，详见[反馈发布隔离与回执](feedback-publication.md)。

学习事件核验、复测配对、实验发布/回退、reviewer登录、独立审核存储、数据删除传播、管理员界面等仍是宿主函数或CLI，没有正式HTTP成功路由；未实现 `/v1/*` 返回501。已有[真实队列采集](field-evidence.md)支持导入和缺失校验，不能伪造人工批准或真人效果。

数据库表结构、迁移和约束见[数据库设计](database.md)，原型需求见[交接文档](HANDOFF.md)。schema合入不表示管理HTTP接口或本地账号归属已实现；新增preload桥接必须按当前契约单独实现。
