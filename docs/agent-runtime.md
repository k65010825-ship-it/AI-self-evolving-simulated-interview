# Agent 内部运行入口

`job.type=closeout-preview` 已接入现有内部runs/HTTP/SSE，用于已完成会话的[修订反馈只读预览](closeout-preview.md)。该任务跳过模型依赖工厂，原始closeout与正式提交不变；编辑权限由宿主注入，预览不能正式提交。

可选[语音任务接口](speech-tasks.md)已加入应用工厂：宿主注入speech manager与真实授权回调后，可登记/上传WAV、查询、确认或取消，使用独立SQLite操作表。默认index尚不自动接线；纯turn/report输入仍只消费已确认候选，不在评分任务里隐式触发ASR。

可选SQLite操作存储已接入live-service启动入口，见[持久任务与预算恢复](durable-runtime.md)。默认仍内存；显式配置后可保存结果/事件/账本、隔离中断任务并对账。它不替代API的正式业务事务；恢复未知请求不自动重发。

本模块连接单轮评估、状态更新、选题和内容报告。业务 API 负责学生身份、会话归属、正式输入快照、任务租约、数据库事务与版本提交。Agent 返回**未提交候选**，不能把内部完成事件直接当作学生侧正式成功。

## 启用与验证

默认 `AGENT_MODE=scaffold`，仅健康检查，内部路径返回 501。显式开启本地 SDK 替身：

```powershell
$env:AGENT_MODE='offline-fixture'
$env:AGENT_INTERNAL_TOKEN=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
bun run dev:agent
```

token 必须由服务部署方提供，32—256 位字母、数字、下划线或连字符。不要把它传给 renderer 或写入日志。进程只监听本机地址；跨主机部署仍需私网与 TLS 配置。

新增默认关闭的`AGENT_MODE=live-service`接线，仅当宿主JSON授权/期限/预算通过时构造百炼／千问Pi后端；凭证按指定服务端变量名延迟读取，不接个人配置。评分、可选知识规划及自然呈现通过forRun绑定同一个run预算。配置与证据边界见[模型接入](model-access.md#百炼live-service入口)。health可返回live-runtime/liveModelConfigured=true，仅表示配置，不证明供应商可用；双岗真实小样本通过也不替代产品/评分质量验收。

`bun run agent:runtime:demo` 在随机本机端口依次演示 Java 后端、Web 前端的 HTTP 接受任务、SSE 事件、快照和候选报告。使用真实 Pi SDK、本地确定性 provider，`liveModelCalls=0`，草案知识须显式允许。这验证通信和流程，不验证模型评分质量。

## 接口

job.type=workflow可执行完整会话的create/plan/answer/finish/restore，沿用同一鉴权/SSE/取消/幂等机制，结果为未提交会话候选，见 [会话HTTP联调](workflow-http.md)。

AGENT_PLANNING_MODE=pi-knowledge可显式启用模型知识规划，默认deterministic。内部turn结果新增可选planning回执，SSE不变，详见 [知识规划](knowledge-planner.md)。

live宿主配置questionDelivery=natural-bridge时，成功评分且有候选的turn可进入presenting并返回delivery。question.completed可选携delivery，其中含原回答的短摘录与桥句；原question保持不变，公开客户端同步升级后再启用。当前不覆盖完整workflow/首题/澄清；正式发题text保存与版本资格仍由API负责，详见[自然提问呈现](question-delivery.md)。

所有下列接口要求 `Authorization: Bearer <AGENT_INTERNAL_TOKEN>`。机器契约见 [内部 OpenAPI](agent-openapi.yaml)、[JSON Schema](agent-runtime-schemas.json)，跨服务真值是 `packages/contracts/src/agent-run.ts`。Zod 的跨字段校验无法全部表达为 JSON Schema，服务端仍会检查 context 一致、报告用户/岗位等约束。

| 方法 | 路径 | 请求/响应 |
| --- | --- | --- |
| POST | /internal/v1/runs | AgentRunRequest → 202 AgentRunSnapshot |
| GET | /internal/v1/runs/{runId} | 200 AgentRunSnapshot |
| GET | /internal/v1/runs/{runId}/events | 200 text/event-stream |
| POST | /internal/v1/runs/{runId}/cancellation | `{ "attemptId": "当前 attempt" }` → 202 快照 |

AgentRunRequest 包含 inputSnapshotId、宿主 context（userId/runId/attemptId/roleId/deadlineAt）和 job。`job.type=turn` 提供 TurnInput、选题 knowledge、askedQuestionIds、allowDraftKnowledge（默认 false）；`job.type=report` 提供完整 ReportInput。单轮内外 context 必须一致；报告只能包含当前用户对应岗位的记录。评分 rubric、知识及用户身份均由可信宿主提供，不能直接照抄学生请求。

turn 结果为 `{kind:'uncommitted-turn-result',proposal,selection}`；report 结果为 `{kind:'uncommitted-report-result',report}`。内部快照含评分依据，**不得不经裁剪直接返回学生端**。API 应核对任务租约、attempt、session/version 和策略 pin，再用事务/CAS 提交。正式公共 `/v1/*` 业务接口依旧 501，尚无 HTTP 提交实现。

## 显式澄清与弃评

turn任务可由宿主添加`clarification:{}`启用；缺省保持原完整评分要求。配置`clarification.policy={maxClarifications:1,minRemainingSeconds:45}`默认最多1次补问，上限2次，至少剩45秒（可设15—120秒）；这是单条宿主receipt链预算，不是整个系统的调用总额度。

合法不足必须逐项输出本次rubric全部criterion，每个暂不能评分的项显式`score:null,evidenceIds:[]`。非null项仍要求合法分数和真实引用；漏项、未知criterion/引用、重复项、空分却带引用、伪造原文等均为MODEL_OUTPUT_INVALID。宿主评分executor只有显式`allowRequiredAbstention=true`才允许required项为null，该选项不属于模型工具参数，默认false。合法部分或全null均不产生观测，不把部分维度重归一化后当整题成绩；有引用的0分仍是正常完整评分。

`evaluateTurnWithClarification`和运行入口返回三类：完整评分仍为原`uncommitted-turn-result`；不足返回`{kind:'uncommitted-unscored-turn-result',resolution,...}`。resolution.status=needs_clarification时附固定中性补问和missingCriterionIds，normalizedScore=null，没有nextState或后续选题；次数用尽或时间不足时status=abstained。次数用尽可在原state上排除当前题后选择后续候选，时间不足则finished；不写0分、不刷新掌握/置信度。模型自由反馈和量规答案锚点不会被用来拼补问。

补充时宿主创建新runId和answerId，固定原state/expectedVersion/observationId/问题/量规/质量/目标等；将原完整回答作为前缀并追加非空说明，传`clarification:{previous:上次resolution}`。receipt绑定冻结输入摘要、已收回答长度/摘要、policy、attempt和原basedOn。改变原文/冻结字段、重置policy、复用上一answer/run、终止receipt续答或时钟回退会拒绝。新完整回答仍受评分输入预算约束，引用偏移以合并后的全文为准。若可评分只记一条最终完整观测；当前接口不自动拼接回答或混合音频片段，语音提交仍须与完整确认文本逐项通过原绑定校验。

SHA只是可重算的一致性检查，不能认证receipt、身份或阻止持有服务权限的人重造历史。业务API必须保存最新receipt、原文、已练/已发题集合，并做所有权/版本/CAS/租约，防止跳过previous、重置次数或并行分叉。内存runtime只提供同runId相同请求幂等，重启后不保留。未评分receipt不自动进入正式report/长期记忆，报告里的已评分答案数不是学生发言数；完整workflow的answer/finish目前仍使用严格评分，需另外接入澄清状态后才能声称全会话支持。

已有`bun run agent:turn:demo`追加双岗真实Pi SDK本地provider演练：第一次null→补充全文→一次完整观测；真实模型调用0。共享schema见evaluation-schemas.json的clarificationPolicy/options/unscoredTurn/turnResolution；运行入口与客户端使用同一agent-run契约，不新增公共业务HTTP。

## 事件、重放与取消

每条事件都有 schemaVersion=1、runId、attemptId、seq、occurredAt、type、payload。seq 从 1 递增。支持 run.accepted、run.stage、question.completed、answer.resolution、run.completed、run.failed、run.cancelled。answer.resolution只含status/questionId/answerId、固定补问、reason/attempt/missingCriterionIds，不含回答、模型反馈、评分锚点或摘要。run.completed 固定 committed=false，仅含 resultKind（含uncommitted-unscored-turn-result）；完整候选从内部快照读取。question.completed 只包含题目，不含 rubric；无虚构 question.delta、模型思考或原始 SDK 日志。

`Last-Event-ID: 2` 或 `?afterSeq=2` 重放 seq>2 并持续订阅；两者同时存在须值相同。未知查询参数、重复 cursor 或非规范整数返回 422，超过已知序号返回 409。任务终态且存量事件发送完成后关闭 SSE。断开 SSE 只退订，任务继续；显式取消才会中止执行。

取消必须匹配当前 attempt。取消或超时之后，即使模型忽略 AbortSignal 并返回迟到结果，也不能发布完成事件或改变终态。取消已完成任务仍返回 completed，不能撤销已生成候选；API 对正式提交资格的撤销需要独立持久控制。

## 内存边界与调度

默认最多保留 32 个运行记录、同时接受 4 个未结束任务；不排队扩容、不自动清理，满后返回 429。请求体最多 2 MiB。单次工作上限 30 秒，且不能超过宿主 deadline；评估器自身还有更小的输入/输出预算与超时。相同 runId 仅支持一个 attempt；相同 schema 归一化内容重试返回既有快照，不重复调用模型，改变内容或 attempt 返回 409。

重启会丢失任务、事件、候选和幂等记录。本实现不承诺跨进程重放、恢复、持久重试、分布式并发或生产可用性。达到容量后由开发进程重启清空，业务 API 必须保留正式状态并决定新 runId 的重试策略。宿主在会话开始时固定的 planningPolicy 同时传给评估编排和下一题选择，避免两者使用不同追问深度。

活动名额按任务占用计算：即使已经取消/超时，未结束的编排或evaluate/plan依赖Promise仍占名额，直至真正settled；wait只等待业务终态，不承诺所有依赖退出。终态条目仍占maxRuns，内部diagnostics计数不通过HTTP暴露。边界与专项命令见[并发隔离评测](agent-reliability.md)。

受控停机时同步关闭start准入，按宽限/取消/有界等待输出drained或incomplete，之后关闭HTTP连接；health仍是存活描述，不作为准入就绪信号。聚合残留和操作系统信号边界见[停机文档](agent-shutdown.md)。

错误来自统一目录：401 服务认证失败，404 运行不存在，409 输入/attempt/游标冲突，413 大小超限，422 输入无效，429 容量满，503 manager 已释放，504 deadline 超时。运行期间失败写入失败快照与 run.failed；不透出供应商原始异常。健康检查 stage=offline-runtime 只表示该离线入口已启用，不检查数据库、真实模型或语音。

## 已确认语音候选

内部turn任务的input新增可选speech，结构为SpeechAnswer；宿主仍需同时提供answer，二者ID/正文必须一致。只传已有确认候选，不传音频字节、不触发ASR调用。评分前校验源用户/岗位、确认时间、原文描述与候选副本，模型只看到确认后的answer.text。report任务随原TurnInput重验，并按answer生成audio_descriptions；SSE事件形状不变，原始转写和音频材料不进入事件。仍是未提交候选，详情见 [语音联动契约](speech.md#运行入口与报告联动)。

完整workflow的plan现可进入presenting阶段，并在question.completed附带delivery；首题保持原题。结果快照的issuedQuestions[].content保留待发题文本及原题/量规/来源绑定，后续answer和报告沿用该文本。它仍是未提交候选，业务API需先校验归属、租约、时间和CAS，再裁剪转发；事件送达不等于学生展示确认。
