# 架构基线 v0.1

runtime/workflow-job.ts将五类会话操作接入内部runs；每次恢复重验输入快照，操作成功后仅发布workflow.updated元数据。正式会话/记忆CAS由业务API执行，见 [会话传输契约](workflow-http.md)。

orchestration/session-workflow.ts以无持久副作用的候选迁移串联首题、回答、收尾，统一返回报告/记忆/反思；快照revision不代替API事务。见 [会话编排](session-workflow.md)。

独立Pi知识规划会话可显式接入runtime：累计状态→宿主目标→模型工具查询→真实岗位回执→宿主选题校验；默认评分器保持无工具。见 [知识规划Agent](knowledge-planner.md)。

部署：Windows Electron 客户端 → HTTPS API → 内部 Agent 服务；PostgreSQL 与私有文件/对象存储由服务端维护。首版单 API、单 Agent 实例，数据库任务/租约方案在正式问答迭代实现。本文描述目标设计，当前状态见 [PRD](prd.md#8-当前实现状态与待定项)。

## 责任与依赖

| 单元 | 拥有的职责 | 不应承担的职责 |
| --- | --- | --- |
| desktop/renderer | React 界面、录音与交互 | 任意 Node/file/shell 或模型凭证 |
| desktop/preload | 白名单 bridge、参数边界 | 通用 IPC、任意 endpoint 转发 |
| desktop/main | 窗口、客户端凭证、远程 API 连接、文件导出 | Agent 推理/模型 key、正式业务数据库 |
| api | 身份/归属、面试/回答/报告/画像、任务、正式提交、事件 | 暴露 Pi 事件、任由模型写业务表 |
| agent | 累计状态规划、知识工具、评估、Pi 适配、反思/实验 | 用户鉴权真值、绕过 attempt 正式提交 |
| contracts | Zod schema、DTO、错误码、归一事件 | 数据库/SDK/Electron 运行时依赖 |
| interview-domain | 岗位规则、纯状态与评分计算 | 网络、凭证、GUI |
| db | Drizzle schema/迁移与 repository | 供客户端或 Agent 直接访问 |

Pi Skill 与固定源码索引在 .agents/skills/pi-agent-development。SDK 最小示例不可直接作为业务会话工厂；资源、工具、状态和环境都需受控。Pi 1.4.0/Bun 1.4.4 已离线试跑，模型供应商无默认选择。

## 请求与提交链路

POST 回答带 Idempotency-Key、sessionVersion；API 同事务保存回答及 AgentRun，提交后才返回 202。任务执行器领取租约与 attemptId，Agent 消费输入快照并返回归一结果。API 检查 lease、attemptId、取消状态和 sessionVersion 后事务提交正式评分/画像/下一题。租约过期的旧结果拒绝，即使 SDK 已生成完整回答。

断流只是连接状态变化；任务继续，重连查询快照并补持久事件。取消先撤销提交资格，再尽力 abort；不能保证供应商已停止计费。事件有 runId、attemptId、seq、schemaVersion，临时 token 不保证全量重放。

## 基础与扩展

知识先用版本化双岗 JSON 导入数据库，工具按岗位/技能过滤和 Top-K 查询；无结果说明不足，不动态抓任意 URL。向量数据库、Redis/MQ、MCP 不作为基础依赖。

语音先录音后转写：ASR 原文与确认文字均保留关联，原音频另做声学/情感；TTS 只播报问题。客户端不装 Bun、SDK 或数据库。Electron 主进程是自带 Node.js；Bun 用于工程与服务端，两种运行环境分开检查。

当前已实现 /health、双岗种子知识执行器及工具适配、公共校验/错误、当前会话证据状态与受限规则规划、初始 schema、桌面安全桥接和静态启动界面。业务未实现入口返回 501；/health 返回 scaffold 状态，不代表面试服务已就绪。

## 数据概览

User → InterviewSession → InterviewTurn → Evaluation；Session → AgentRun → RunAttempt/RunEvent。RoleProfile → KnowledgeItem/Question/Rubric。User+Role+Skill → SkillObservation/Profile。Recommendation → LearningProgress → PredictionSnapshot/PerformancePair → Reflection → PolicyVersion/EvalExperiment。

骨架 schema 仅放基础表，完整状态机、迁移、事务和持久化属于后续任务。各实体明确区分：产品会话、SDK 上下文、任务执行与长期画像不能用同一份 JSONL 替代。

## 面试状态与规划

跨会话适配位于memory/session-memory.ts：宿主读取/保存用户+岗位快照，Agent只负责报告证据重校验、最小投影、幂等追加、JSON恢复和下一场注入。InterviewState的priorEvidence与本场observations分离，历史不能增加本轮版本、覆盖或轮次；估计以原时间计算衰减，重复原题不增加独立证据，选题自动排除历史题。该快照不是SDK JSONL，当前没有正式数据库repository/迁移/事务/重启恢复。删除用户数据时后端需传播到记忆、报告和派生状态，不能仅删除原始回答。

InterviewState 保存已测/待测技能、各技能 mastery/confidence、薄弱点、已练题、剩余时间、难度、当前追问深度；历史画像初始化后，每轮按新证据更新。不是仅靠聊天摘要或上一句关键词。

已实现的当前会话模块位于 apps/agent/src/planning/interview-state.ts，公共 schema 位于 packages/contracts/src/interview-state.ts；执行 bun run agent:state:demo。状态保存宿主指定岗位/技能和原始观测，mastery/confidence 按证据与查询时间派生，避免两份状态漂移。它不直接读取数据库，也不构成跨会话持久记忆。

初始规则：mastery 是固定 rubric 下归一技能分按 quality 加权的均值；confidence = min(1,独立题数/3) × min(1,题型数/2) × (1-分数极差) × 平均 quality × 时效，时效半衰期 7 天。范围 [0,1]，表示启发式证据充分度，不是已校准正确概率。缺证据时 mastery=null、confidence=0；重复原题保留轨迹但仅首次作为独立证据，不能刷新独立证据时效。候选排序综合岗位相关度、低置信、薄弱与覆盖缺口；当前实现确定性候选与约束决策，真实 LLM 规划/评估接入仍待完成。

观测由宿主/评估边界提交，包含 observationId、roleId、skillId、questionId、questionType、difficulty、score、quality、observedAt；模型不能直接修改状态/版本。相同 observationId 内容相同可幂等重放，内容不同或新观测版本落后拒绝；新观测时间不能早于已接收的最新观测，避免迟到评分重置当前技能/深度。恢复快照同样拒绝倒序历史及同题跨技能冲突。完全相同的旧观测重放先按幂等处理，不新增证据；超时后也不允许新写入。快照不可变更新，但进程内版本检查不等同数据库 CAS，后端仍需事务和租约。

规则规划默认保留 30 秒收尾、最多 12 次观测轮次、同技能最多 2 层连续追问。达到深度上限时排除当前技能，选择其他候选或收尾；低掌握的当前技能可降一档难度。决定中的 difficulty 是建议，实际题目难度仍由后续提问/观测上下文确认。真实模型、报告和自动 RSI 未因该规则模块完成而自动实现。

动作限定 deepen / switch_skill / adjust_difficulty / finish。模型依据累计状态选择知识和动作，程序约束时间、重复题、覆盖、追问深度与合法输出。保存简短依据与证据引用，不保存内部推理链。

目标会话状态：planning → awaiting_answer → processing_answer → awaiting_answer / completed；非终态可进入 cancelled 或 failed。目标任务状态：queued → running → completed / failed / cancelled。各轮和状态迁移在 API 内检查 sessionVersion；已完成会话不接受新答案。HTTP 数据对象见 [接口文档](api.md)。

## 语音与评估

当前已实现独立speech宿主层：受限PCM WAV解析、ASR provider注入、能量活动/停顿候选、原始转写与确认文关联。实现及计算口径见 [语音模块](speech.md)。演示使用合成音频/手工转写，确认候选已接入内部turn/report与逐回答音频描述；尚未接入真实ASR、麦克风、HTTP上传或原始音频job。

单轮编排入口 apps/agent/src/orchestration/evaluate-turn.ts：宿主输入已授权状态/问题/回答/规则与质量权重，先查岗位/版本/期限/观测 ID，再构造完整评分上下文，调用可替换 EvaluationDependencies.evaluate。输出必须通过公共 EvaluationOutputSchema、原文证据匹配与固定 rubric 算分；仅完整内容评分才能进入观测候选，部分评分拒绝推进。质量由宿主注入，不接受模型自报置信度来提高证据质量。

评估阶段有总请求字符上限（含问题/rubric，默认16000）与等待超时（默认10秒、最多60秒），同时受 run/session 期限限制。使用 AbortSignal 和 Promise.race：即使端口忽略信号，宿主也会停止等待；后台外部运算是否真的停止仍需供应商验证。完成后重新检查取消/期限，清理计时器和监听器；不做自动修复或重试。返回 uncommitted-turn-proposal，包含 basedOn、已核验证据、分维内容分、反馈、nextState 与 nextAction；不会写数据库或更新传入状态。API 最终仍必须检查所有权、活跃 attempt/租约、取消状态和 sessionVersion，并将评分/证据/状态原子提交。独立评估请求是结构化端口，不等于已经完成 Pi 真实模型适配。

已实现的前置模块：context/build-context.ts 根据累计状态构造版本化提示载荷，按实际序列化 UTF-16 长度限额；工具授权仍由宿主执行，提示词不构成安全边界。tools/scoring-executor.ts 接受宿主注入的 rubric、回答和已登记原文证据，根据模型/调用方各维度分数做确定性归一计算，输出缺失项与覆盖率。它不负责判断技术回答正确性，不构成完整报告或自动 RSI。Pi 评分适配器默认未注册。两岗计算样例与运行方式见工具契约。

原音频一条分支做 ASR，原始转写与学生确认文同时关联；内容评估使用确认文。另一条分支从原音频取得有声时长、停顿等特征和中文情感推断，支撑表达反馈。音频清晰度是待人工样例验证的可懂度估计，不能直接使用 ASR confidence 代替自信或发音评分。

报告区分技术正确性、深度、逻辑、岗位匹配、表达结构/沟通；语音才追加声学/情感维度。文字输入的音频维度为 null；噪声、过短、口音等情况标不足。TTS 播报问题与模型推理接口分别适配，不要求经 Pi 代理所有语音请求。

原音频默认处理/确认后删除；用于听审时单独告知并同意保留至交付后 7 天。删除后时间片段和统计仍可说明依据，但必须标不可回放。画像、报告与删除请求按所有权处理；日志不记录完整音频、简历或密钥。

## 反思与策略版本

学习证据与复测配对见learning/progress.ts、retest-pair.ts与[契约](learning-retest.md)。任务事件不把点击/自报视为核实完成；冻结预测与当前掌握度独立，题目暴露前保存由API保证。配对重校验报告/时间/学习条件/参考评分元数据，不实际认证artifact或人工审核。统计按技能/岗位/模式/预测器/量规/难度分组，少于8配对或2学生时MAE=null；synthetic不能触发真实发布。下一步需统一Agent运行入口/归一事件，方便API任务/取消联调。

离线实验状态机reflection/experiment-registry.ts将候选全量重新评测后应用到实验快照，失败不改active，祖先回退及操作摘要幂等保留审计；scope仅offline-experiment。会话启动pin是脱离registry的副本，后端必须一次保存并复用，不得每轮读取active。JSON恢复验证审计结构/算术，不复原原验证请求或认证来源。正式事务、champion发布和数据库重启仍待对接。

已实现宿主pin策略的轨迹反思、受限单步深度候选与分组隔离的成对合成验证，详见[模块契约](agent-reflection.md)。只在实际技能/难度均遵循规划时考虑候选；验证阻止开发会话通过priorEvidence混入。当前返回离线资格，deploymentStatus始终not_published，下文champion启用/回退和PerformancePair仍为目标设计。

当前已实现 reporting/build-report.ts 内容报告函数：对宿主快照与全量轮次逐步回放、重算固定量规、验证证据与引用，再生成结构化报告和最多3项练习。计算重放使用原观测时间，不发模型请求，不是超时运行的新提交。它复用累计状态估计，音频/表达缺失、混合量规、合成来源均显式标记，不给跨量规整场总分。初始快照和provenance由宿主保证，回放不能证明其真实来源。报告草稿和原评估反馈不等于模型已独立生成综合报告；正式归属/存储/报告ID仍归API。资源推荐、音频、成长曲线与反思策略不因报告模块完成而自动实现。

每场反思先记录追问目标、新增证据、重复/漏测、时间与不确定性；无复测时等待后续数据。当前能力估计、学习增益和带学习条件/期限的未来成绩预测分开存储。PredictionSnapshot 在看到复测题/答案前固定，符合期限、难度、学习暴露和 rubric 的样本才进入 PerformancePair。

首版固定评分 rubric，候选只调整 uncertaintyPriorityBoost、maxFollowupDepth、coverageReserveRatio 等白名单参数，预设范围和单次上限，模型不能改发布门槛或权限。保留基线 v0；会话启动固定策略，正在进行的会话不随新版本变动。

自动门槛使用预标注分支场景和内部验证参考评分；通过后事务更新实验范围 champion，失败保留旧版。真人命中率独立盲审，不能把场景代理当真人效果。支持人工审计与回退，普通正式发布可另有管理员控制，但不能替代自动实验链路。数据门槛、预测字段和指标见 [评测计划](evaluation-plan.md)。

## 工程与交付约束

资源层：tools/resource-executor.ts只访问宿主目录快照，负责角色/等级/审核/时效/调用预算/URL元数据约束；reporting/recommend-resources.ts把报告练习计划转为实际查询，再附推荐和回执。它不调用模型、不写学习状态、不抓外部URL。空结果保留缺口，error不返回部分增强结果；await后重查取消/期限。默认学习状态not_started，完成证据和复测配对归API后续实现。Pi资源包装可显式注册，不改变现有知识工具默认白名单或无工具评估配置。

Pi评估适配器 adapters/pi/evaluator.ts 接收宿主显式runtime/model/role/cwd，不自行创建凭证runtime。每次调用全新SessionManager.inMemory与无资源loader，tools/customTools均为空；原知识工具会话默认配置不变。固定system包含EvaluationOutput JSON Schema，当前问题/回答/量规作为user JSON数据，不用请求中的systemPrompt覆盖评估策略。订阅后prompt，必须settled且未aborted、最终assistant.stopReason=stop，严格解析单个JSON对象并做schema校验。截断、工具尝试、额外字段、过量输出均拒绝；不宽松提取代码块或重试修复。流式与最终长度均设限，默认输出12000 UTF-16单位，完整提示默认24000，等待10秒，宿主可以下调。所有路径清理监听器/计时器和session；晚创建的session也dispose。

确定性选题器 planning/select-question.ts 重用decideNextAction累计状态规划，匹配当前岗位/目标技能，排除askedQuestionIds和已观测题目，按与建议难度差、再按ID排序。保留题目真实难度，不把建议难度写成实际难度。返回selected/unavailable/finished；缺题不偷偷改技能、不跨岗、不自动生成。knowledge来源由宿主查询/维护，本函数不扫描网络或自行扩大检索。现已选技术/场景/项目/行为题；行为独立behavioral-content，项目与行为多维量规、历史构念隔离见 [内容量规](content-rubrics.md)。

selected包含独立的question、rubric和source，question仅允许问题ID/岗位/技能/正文/题型/难度；renderer只接收question，不接收整份selected，避免泄漏评分规则与来源内的参考材料。API须保存发题记录及来源版本，后续评估绑定该记录；候选产生不等于已经发题。公开数据源仍为draft，离线演示显式启用，不升级审核态。

共享契约位于 packages/contracts；跨服务事件转换留在 Pi 适配层，前端不接 SDK 原始事件。Electron contextIsolation/sandbox 开启、nodeIntegration 关闭，preload 仅命名白名单方法，主进程验证发送来源。当前桥接只有版本与健康查询，语音权限仍默认拒绝。

创建/恢复 Pi 会话显式指定资源、工具、settings、session 和 runtime；不读取个人全局资源。凭证留在服务器，SDK 恢复不代表业务任务或外部副作用可恰好一次恢复。工具契约、预算与错误由 [tool-contracts.md](tool-contracts.md) 和 [error-handling.md](error-handling.md) 定义。

三人模块所有权、分周目标和 PR 流程见 [collaboration.md](collaboration.md)。签名安装包、非开发机测试、HTTPS、数据库备份/恢复须独立验证，不能用桌面构建通过替代。

不为了像 Craft 增加桌面内置服务器、双 SDK 或通用 SessionManager 巨类。

## Agent 内部运行入口（离线已实现）

`runtime/run-manager.ts` 统一 turn/report 生命周期、顺序事件、候选快照、幂等、取消与截止时间；选题复用宿主固定策略。显式 offline-fixture 模式才开启内部 HTTP/SSE，采用独立服务 token。默认最多32个记录、4个活跃任务，无持久恢复。两岗可通过本地 TCP 与真实 SDK 替身演示，不调用真实模型、不提交业务数据。接口与后端联调责任见 [运行入口契约](agent-runtime.md)。


## 会话收尾后的 RSI 实验

内部 runs 新增 `job.type=rsi`，输入完整已收尾 Workflow 和实验快照，返回 `kind=uncommitted-workflow-rsi`。SDK 支持执行与安全事件订阅；SSE 只输出合成聚合指标。离线实验可激活、拒绝或重放，原会话策略不变；下一场 pin 仅预览、未写正式库。来源校验、隔离规则、回滚重放及接口字段见 [会话收尾与 RSI 离线实验](workflow-rsi.md)。
