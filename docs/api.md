# 接口文档

业务API调用Agent可复用@interview/agent-client，支持typed start/get/cancel/events/wait/execute，详见 [客户端SDK](agent-client.md)。SDK不会替业务后端提交会话或自动重试写请求。

workflow候选可使用SDK的prepareWorkflowCommit生成未提交事务计划，检查任务/fence/租约、归属与动作连续性，并交由API执行存储/画像CAS和唯一回执事务，见[提交适配协议](workflow-commit.md)。该helper和内存演练不新增正式HTTP成功路由，不表示数据库已经接入。

Agent完整会话已通过内部runs的workflow任务支持create/plan/answer/finish/restore，见 [HTTP/SSE联调](workflow-http.md)、[宿主契约](session-workflow.md)。仍无正式业务HTTP或会话存储，API负责持久任务、幂等与CAS。

内部turn可由服务配置启用Pi知识规划；请求不增加身份参数，结果新增可选planning={kind,selection,receipts,modelMessages}。默认确定性选择，机器schema见planner-schemas.json，详情见 [知识规划契约](knowledge-planner.md)。

语音转写、WAV能量特征与确认候选宿主函数已实现，见 [语音契约](speech.md) 和 speech-schemas.json。内部 turn 的 input 可附 speech，report 可输出逐回答音频描述；仍无上传/转写HTTP路由、原始音频job或正式业务语音提交接口。

学习证据与复测配对宿主函数已实现，详见[契约说明](learning-retest.md)。机器定义新增learningProgress/learningEventRequest/prediction/pairRetestInput/performancePair/calibrationInput/calibrationSummary；没有正式学习/复测HTTP写入接口，业务路径仍为501。

反思/离线策略评测宿主函数已实现，参数、指标、错误与未发布边界见[反思模块契约](agent-reflection.md)。对应reflectionInput/reflection/policyEvaluationInput/policyEvaluation机器schema位于evaluation-schemas.json；尚无正式策略HTTP发布接口。

离线实验状态机及会话策略副本现已实现，见同一契约的“离线实验状态机与会话固定”。机器定义新增experimentRegistry/experimentOperation/sessionPolicyPin。仅offline-experiment的宿主函数；评测重新执行、合法失败留审计、通过只切实验active，正式HTTP/CAS/管理员认证仍未实现。

版本：v1 开发基线。面向前端、业务后端与 Agent 联调。**正式业务 API 仅 GET /health 可用，其余正式业务接口仍返回 501。Agent 显式离线模式的内部运行接口已实现，见第 6 节。** 下文请求约束已在 OpenAPI 中定义；业务成功对象与 SSE payload 是目标约定，实现前须同步到公共 schema 和 OpenAPI。

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

Agent 默认 service 为 agent，stage 为 scaffold；显式离线入口启用后 stage 为 offline-runtime，capabilities 为 internal-in-memory-runtime、typed-sse、offline-evaluator。此接口不检查真实模型、语音或数据库就绪。

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

报告未生成时目标返回 409 VERSION_CONFLICT，并通过快照继续查询；无权限 403，不存在/不可见按权限策略返回 404。正式目标报告有 reportId、interviewId、roleId、评分/策略版本、各维 score/evidence、亮点/不足、练习和资源建议。无音频维度为 null，不能填零。当前仅实现下文内容报告函数契约，HTTP路径仍返回501；不能当作完整综合报告或正式报告存储。

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

Agent 默认仅健康检查；显式 AGENT_MODE=offline-fixture 并提供独立内部 token 后，支持内部运行创建、快照、SSE 与取消。详见 [内部运行契约](agent-runtime.md)、[独立 OpenAPI](agent-openapi.yaml)。apps/agent/src/runtime/backend.ts 对应实际内存接口。所有结果是候选，业务 API 仍须验证归属、持久保存输入、核对租约并正式提交，客户端不能直连。

query_role_knowledge 是 SDK 内工具，不是公开 HTTP 查询端点。模型输入 roleId/skillId/purpose/query/limit，执行上下文由宿主注入；详见[工具契约](tool-contracts.md)与[工具 JSON Schema](tool-schemas.json)。

桌面当前暴露的桥接只有 window.interview.getVersion() 与 getApiHealth()；不能调用通用 ipcRenderer、任意 channel 或任意 URL。新增提交/取消/订阅桥接时须按本文契约单独实现。

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

待进一步设计：登录/刷新、音频上传与转写、学习资源/完成记录、结束面试、策略审核/回退等 HTTP 端点。它们是产品需求，尚未冻结路径和请求体，不能据界面先假定已可调用。

## Agent 单轮函数契约（已实现，另有内部运行入口）

执行 `bun run agent:turn:demo` 可查看离线输入与未提交结果。契约真值 packages/contracts/src/evaluation.ts；机器定义 [evaluation-schemas.json](evaluation-schemas.json) 随 openapi:generate 生成。业务 HTTP 路径继续返回 501。

| 输入组 | 字段/职责 |
| --- | --- |
| 宿主状态 | state、expectedVersion、observationId；拒绝旧版本和已存在观测 ID |
| 宿主授权 | context 的 userId/runId/attemptId/roleId/deadlineAt；调用函数前 API 已验证归属，不接受模型提供 |
| 题目/回答 | question 的 id/roleId/skillId/text/questionType/difficulty；answer 的 id/text；必须绑定真实已发题，当前函数仅检验 schema/技能/岗位，发题归属由后端保证 |
| 评估条件 | goal、固定 rubric、knowledge、quality；quality 是宿主证据权重，并非已校准概率 |
| 依赖注入 | evaluate(request,signal)、now、signal、timeoutMs、maxRequestCharacters；这是可信宿主代码接口，不是用户可编辑 HTTP 字段 |

evaluate 只获得必要上下文、题目正文/技能/类型/难度及固定 rubric，不传 userId/sessionId/runId/attemptId。输出为 evidence[{id,start,end,excerpt}]、criterionScores[{criterionId,score,evidenceIds}]、feedback{strengths,improvements}，所有对象严格校验，不接受 roleId/quality/新状态。摘录先校验出处，语义是否支撑分数尚需评测。反馈仍为不可信文本，界面须按普通文本渲染。

结果 kind=uncommitted-turn-proposal；basedOn 包含 sessionId/sessionVersion/runId/attemptId/answerId/questionId，另有 evaluation、evidence、feedback、nextState、nextAction。仅评分完整时返回，不足或非法评估为 MODEL_OUTPUT_INVALID。相同 observationId 在已有状态中直接返回 VERSION_CONFLICT，避免重新评价；已提交答案的幂等返回需由 API 保存并复用原结果，仅内部运行入口保留单进程同 runId 的候选缓存，函数自身无缓存。nextAction 仅表示动作与技能建议；选择下一题由下节的独立宿主函数完成，自动生成新题仍未实现。

## Pi评估与选题函数（已离线验证，内部运行可调用）

`createPiEvaluator({cwd,modelRuntime,model,roleId,...limits})` 返回 evaluate(request,signal)，可注入evaluateTurn。每次全新无工具内存会话，固定系统策略与严格最终JSON校验。runtime/model由可信宿主管理，不从客户端接收，也不使用个人Pi配置。当前运行样例只注册本地provider；真实付费模型/语音仍需授权与预算。

`selectNextQuestion({state,now,knowledge,askedQuestionIds},{allowDraftKnowledge?})` 是同步宿主函数，机器定义位于evaluation-schemas.json的selectionInput/selectionOutput。knowledge必须全为本岗且ID唯一；askedQuestionIds由后端提供，包含已发但未答题；历史已答题还会从state.observations排除。默认不接受草案，allowDraftKnowledge仅离线演示显式启用。

| status | 返回字段 | 含义 |
| --- | --- | --- |
| selected | plan、question、rubric、source | 未提交选题；source含knowledgeId/version/sourceIds/reviewStatus，rubric描述来自题目知识 |
| unavailable | plan、reason=no_eligible_question | 该规划技能没有合格新题；不自动放宽约束 |
| finished | plan | 规划已收尾，不再选题 |

question可用于学生界面；rubric/source留在服务端，不把整个选择结果直接转给renderer。当前已接入技术/场景/项目/行为题；行为量规独立scope，完整面试结束流程仍待实现。项目/行为新增维度、锚点与证据规则，详见 [内容量规](content-rubrics.md)。没有数据库发题事务，多个并发选择仍可能得到同题，API必须版本检查并原子保存发题记录。

## 内容报告函数（已实现，内部运行可调用）

`buildInterviewReport({state,generatedAt,policyVersion,skillLabels,turns})` 为异步纯计算函数。公共契约packages/contracts/src/report.ts，机器定义evaluation-schemas.json的reportInput/contentReport。state是宿主最终快照；skillLabels须完整映射配置技能；turns每项包含原TurnInput、对应TurnProposal和宿主声明的evidenceMode（offline-fixture/live-model/unverified）。最多200条，必须一条观测对应一条记录；顺序可不同，按观测顺序核对。

函数重新执行原文证据匹配与固定量规计算，核对answer/question/run/attempt/session/version、每步状态与最终快照；同一量规ID/version定义不得变化，重复回答ID/记录、错配或缺记录拒绝。数据归属、输入快照来源及provenance声明真实性仍由API负责；该检查不证明数据来自真实模型或已正式提交。

结果kind=uncommitted-content-report，含sessionId/version、roleId、generatedAt、policyVersion、evidenceMode、coverage、skills、assessments、expression、studyPlan、resourceRecommendations和warnings。assessments逐轮保留评分、量规版本与描述、问题、引用摘录、原评估反馈；不把不同量规的同名维度直接平均，也不输出overallScore。skills复用现有启发式估计，重复原题只计首次独立证据；多量规技能带版本列表和警告，不代表已校准成绩。

未知掌握度为null；无关联语音时expression.status=not_evaluated、reason=no_confirmed_audio。有关联语音时status=audio_descriptions，逐回答保留原文速率、确认文和来源；speechRate整体值与clarity/confidence仍为null，不生成心理或表达质量评分。studyPlan最多3项，依次安排已知薄弱、未考察、低置信技能；有回答时引用原改进建议，无证据时给诊断练习，含建议时长和同技能不同题复测。它是规则建议，不承诺提分，也不自动标完成。基础报告的resourceRecommendations为空，资源由下节宿主增强函数另行查询附加。

宿主来源声明含unverified则整体unverified，多种已声明来源为mixed；离线报告不得冒充真实模型效果。`bun run agent:report:demo` 运行两岗真实SDK＋本地provider的报告草稿；后端后续独立分配正式reportId、鉴权/保存/删除和HTTP读取。

## 报告资源增强函数（已实现，无HTTP路由）

`recommendResources(report,context,catalog,options?)` 返回{report,queries}，不修改输入报告；report是共享ContentReport契约，queries为实际资源工具回执。宿主须确认报告所有权与sessionVersion，函数只能核对岗位和结构；context/catalog/options均不是模型身份参数。机器契约见工具schema与evaluation-schemas.json的resourceEnrichment。

对studyPlan逐项查询，未知/薄弱使用foundational，低置信复核使用intermediate，每项最多2条，共最多6条。无命中保留resource_gap:skillId警告；推荐含skillId、reason、explanation、catalogVersion、resource及learningStatus=not_started。精确等级不匹配也返回缺口，规则尚未经过效果校准。查询错误或最后一次等待期间取消/超时均拒绝返回增强结果，不保留半成品。刷新时替换旧推荐并重建资源缺口警告。

目录内容读取成功但人工未审时仍为draft，默认不推荐；`bun run agent:resources:demo`显式开启草案演示，报告带draft_resource_recommendations。默认工具会话未自动扩权，Pi资源包装需后续宿主显式注册。工具调用/推荐/打开链接都不代表学习完成；点击、自报完成、可核实练习记录仍为后端后续能力。HTTP路径继续501。

## 跨会话记忆函数（已实现，存储由后端负责）

公共契约packages/contracts/src/memory.ts，机器定义evaluation-schemas.json的memorySnapshot/appendMemory/startSessionMemory。所有参数来自可信宿主，不作为模型工具或未鉴权HTTP入口。

| 函数 | 输入/输出 |
| --- | --- |
| createMemory(identity,now) | identity={userId,roleId}，返回version=0的uncommitted-memory-snapshot |
| appendMemory(snapshot,request) | request含identity、expectedVersion、sessionStatus=completed、now、reportInput；重校验报告、校验所有轮次用户，返回新快照 |
| restoreMemory(json,identity) | 解析JSON并校验schema/归属/岗位，不是自动查数据库；上限400万UTF-16单位 |
| startSessionFromMemory(snapshot,request) | identity、now与CreateInterviewState的session；返回新会话state，priorEvidence只注入当前配置技能历史 |

记忆最多20个完成会话，每场最多200条观测；超限拒绝，不静默删除或截断。快照保存用户/岗位、版本/时间、会话ID及最小观测、题目/技能/量规版本/证据模式，不保存回答正文、反馈、run/attempt或凭证。宿主声明completed与来源真实性仍需API核验；结构校验不是签名或所有权数据库证明。

相同会话内容相同可幂等重放，即使已追加后续会话也不重复增加；同ID内容变化或新追加expectedVersion落后拒绝VERSION_CONFLICT。acceptedAt保留首次接收时间，旧请求重放不能早于该时间；新追加还须不早于updatedAt。用户不匹配FORBIDDEN，岗位不匹配ROLE_FORBIDDEN；schema/时钟/记录/容量错误VALIDATION_ERROR。最终数据库CAS、租约和已完成状态仍须后端检查，不能把内存版本检查当分布式锁。

InterviewState增加priorEvidence默认空，兼容不含该字段的旧快照。历史必须在新场开始前、题目技能一致且无重复会话观测；本场observations/version/currentSkillId/followupDepth均重新开始。估计结合历史和当前首次独立题证据，保留原始时间衰减；covered只表示本场考察，maxTurns不含历史。选题排除历史已答题，复测需同技能不同题；只记录已答题，未答发题历史仍由API提供askedQuestionIds。

报告继续标记历史来源和量规，observedSkills/totalAnswers是本场覆盖，independentQuestions含历史并带警告。多量规启发式估计不代表可比成长；不生成学习增益或RSI提升。`bun run agent:memory:demo`只演示两场真实SDK＋本地provider、JSON往返和新题选择；没有数据库写入、进程重启验收或真实模型质量结论。

## 多维内容量规

Rubric.criteria与知识rubric新增可选dimension/evidenceRule/anchors，宿主透传给Pi评估器，模型不能修改权重。技术/项目/场景与行为scope分离，报告scope可以mixed-content并考虑历史。assessments新增可选questionType以兼容旧报告；同技能构念混合的旧快照拒绝，后端须审核迁移。具体锚点、证据不足、来源与评分边界见 [量规契约](content-rubrics.md)。


## 会话收尾后的 RSI 实验

内部 runs 新增 `job.type=rsi`，输入完整已收尾 Workflow 和实验快照，返回 `kind=uncommitted-workflow-rsi`。SDK 支持执行与安全事件订阅；SSE 只输出合成聚合指标。离线实验可激活、拒绝或重放，原会话策略不变；下一场 pin 仅预览、未写正式库。来源校验、隔离规则、回滚重放及接口字段见 [会话收尾与 RSI 离线实验](workflow-rsi.md)。
