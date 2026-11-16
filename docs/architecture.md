# 架构与职责

**本地运行时已完成离线文字阶段（2026-11-10）**：主进程通过stdio管理独立子进程；`apps/agent/src/local`的宿主负责身份、单库事务、会话/记忆和任务恢复，`packages/local-agent-client`负责spawn/协议/退出。已完成随包Bun产物的双岗重启验收，本地live文字/私有凭证代理及v2迁移已接入，采用注入HTTP离线验证；本地语音与v3迁移已接入并离线注入验证；音频硬件/凭证库/桌面接线待完成。见[设计](client-runtime.md)与[本地接口](local-runtime-api.md)。以下保留旧服务端架构和复用机制，不能将其API所有权或服务端验收当作新默认入口。

本轮开发范围仅为Agent。外部客户端由队友实现，通过主进程stdio访问本地宿主；旧业务API仅用于服务回归；本仓库桌面实现已删除。借鉴Craft的契约/共享业务/应用装配分层、来源与权限集中管理；本项目使用Pi SDK1.4.0，按安装包声明隔离资源与工具，不照搬编码Agent的本地权限。

## 1. 应用边界

| 层 | 所有权 |
| --- | --- |
| packages/contracts | Zod类型、请求/结果、错误、状态与预算schema的跨服务真值 |
| packages/interview-domain | 无IO领域规则与可解释反馈 |
| packages/agent-client | 内部HTTP/SSE消费、候选提交验证；不代替数据库事务 |
| apps/api/src/pilot | 学生认证/归属、当前题目、正式会话与记忆、操作幂等和CAS回执 |
| apps/agent/src | 规划、知识/评分/资源工具、记忆视图、Pi会话、恢复、语音、操作账本 |
| apps/pilot | 两个独立服务的配置与装配、跨进程会话额度策略 |
| Agent CLI | 真实参与者本机采集、显式模型评分、分岗盲审导出；不扩展桌面UI |

API与Agent当前在同一服务器上运行，分别持有SQLite连接；WAL、IMMEDIATE事务与busy_timeout用于本机并发。它不是跨服务器共享文件数据库方案。packages/db保留PostgreSQL/Drizzle目标模型，尚未迁移。面向真实多机部署应由API管理正式数据库和预算服务，不把SQLite文件放网络共享盘。

## 2. 一次面试

登录 → API创建正式session/不可变额度/操作票据 → Agent产生create候选 → API提交CAS → 规划读取累计掌握度/置信度/时间 → Pi按需调用知识工具 → 宿主校验岗位/难度/未练题 → 自然承接＋真实题目 → 学生回答 → 独立Pi评分 → 严格引用/量规计算 → 状态候选 → API事务提交。

同题澄清保留原回答与neutral提示，弃评不写0分、不推进能力观测。收尾输出多维报告、练习计划、记忆与反思候选。API统一事务保存正式workflow、跨会话memory及唯一回执；Agent不直写正式表。旧版本/跨用户/被取消/不匹配候选拒绝提交。

详见[工作流](session-workflow.md)、[HTTP](workflow-http.md)、[CAS](workflow-commit.md)、[澄清](workflow-clarification.md)。当前pilot没有接强制发题展示回执策略，question-ack适配仍由后续产品联调选择启用；不假称已验证学生实际阅读。

## 3. 规划、记忆与上下文

状态由原始证据派生，包含各技能掌握度和置信度、覆盖、深度、历史已练题与剩余预算。选择方向考虑岗位相关性、薄弱和不确定性，不能按题库顺序。知识query由模型决定，宿主强制身份/岗位/权限/Top-K/截止时间和工具参数校验；当前是真实本地工具，不依赖MCP服务。

完整证据保存在正式API记录，记忆召回只是有界视图。按用户/岗位/量规版本隔离，优先近期薄弱与低置信度，历史不冒充本场新证据。规划上下文预处理去重、相关性排序与预算裁剪；评分只读取当前题/答案/量规，剥离历史画像，防止历史能力暗示评分。

模型传输独立维护wire上下文：预处理预算 → auto_compact阈值检查 → HTTP → 上下文超限时reactive_compact → 有预算重发。压缩不改正式证据，不丢系统约束或拆散工具调用/回执对；不能压缩到安全预算则明确失败。输出截断与context overflow分开处理：提额、重新生成或受控续写都计入尝试；无完整有效JSON不提交。Pi隐式重试/压缩关闭，统一宿主调度。见[记忆](memory-context.md)、[恢复](model-recovery.md)。

## 4. 语音链路

Agent接收宿主已经授权的规范WAV（16kHz/mono/PCM16），校验当前题目、归属、摘要、时限与预算，进入持久ASR任务；原转写和用户确认文分离。采集设备、客户端录音和UI由前端同学负责，本轮不实现。

原WAV只在内存处理，SQLite保存操作记录与转写候选。独立表达观察受音频时长与逐字引用约束，不进入正式综合分；TTS仅合成宿主授权的当前题目，忽略供应商下载URL。见[语音任务](speech-tasks.md)与[表达观察](expression-assessment.md)。

真人质量验证通过独立CLI进行，先采集本人文本回答，再显式调用Pi评分；每岗8题和对应量规冻结，回答不可改，独立审核者不接收模型分数。默认不发网络请求，真实身份和审核独立性仍须人工核验。见[真人双岗验收](agent-field-acceptance.md)。

## 5. 持久任务与统一额度

Agent SQLite保存任务、事件、模型尝试、lease/fence与幂等；API保存正式操作票据。崩溃不能证明外部调用未收费：已派发残留转unknown并保留预留，无证据不自动重试；终态任务也恢复账目。事件续订与任务恢复不同，SSE成功不是正式业务提交。

统一accounting.sqlite按真实session/user/role限定LLM/ASR/TTS跨轮、跨进程额度：reserve → dispatch → responded/unknown → reconcile。reserve/dispatch先于任何真实HTTP；写入失败则HTTP=0。responded释放并发但保留费用；unknown保留并发/费用直到宿主有据对账。LLMusage按声明费率估算，不称供应商账单；导入证据CAS也不自动认证发票。见[统一会话额度](session-accounting.md)、[试点runtime](pilot-runtime.md)、[运行手册](pilot.md)。

## 6. 质量与双闭环

学生侧已有报告/练习/不同题复测和历史记忆规则；系统侧已有自动反思/策略候选/合成实验激活与回退。真实学习核验与复测数据必须独立采集；正式策略发布仍需业务端与管理员权限，当前不自动把offline-experiment策略发给全部学生。

独立评分、自然承接/泄题、表达可靠性、知识批准和真实RSI不能由代码制造。field-evidence工具导出盲审包、校验版本/来源/审核者分组，拒绝自审、污染和缺失分母，支持真实前后表现的描述性分析。无真实标签时not_ready，不把合成收益当真人因果效果。详见[采集门禁](field-evidence.md)、[评测计划](evaluation-plan.md)。

## 7. Agent Harness与阶段侧链

Pi为唯一模型运行时；规划/评分/承接语共享`createHarnessPiSession`。按阶段动态加载技能正文，严格固定工具白名单和空本地资源发现；共享CompletionGate检查工具/最终消息/settled及宿主验证，返回校验结果副本。宿主验证钩子异常拒绝结果，不能作为普通日志忽略。Claude的PostToolUse/Stop为设计参考，不宣称这些SDK事件本身提供强安全保证。

评分的格式修复使用请求局部Pi会话树检查点，保留失败分支且不将其输出回灌主循环；正式业务和预算不会被树导航回滚。wire压缩插件只可删选已知规划可选memory，auto/reactive沿同一宿主预算恢复。技能/工具源/钩子/侧链分别装配，当前工具源为local；不虚称已有MCP服务或第二SDK运行时。完整机制与面试解释见[Agent Harness](agent-harness.md)。

当前面试业务不建设通用插件市场、任意会话树重放或递归子Agent调度。工厂已强制注册阶段业务guard，规划题目必须来自本次验证回执，非法钩子配置在SDK分配前拒绝；额外钩子不能替换默认校验。既有宿主阶段路由、受保护auto/reactive压缩和持久任务恢复为正式边界，建设触发条件见[业务机制决策](agent-harness.md)。
