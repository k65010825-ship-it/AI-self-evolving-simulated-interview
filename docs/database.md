# 数据库设计与接入边界

版本0.3，2026-11-16。产品架构以[架构文档](architecture.md)为准：学生端由本地宿主提交正式数据，中央管理API只处理账号、团队内容、授权样本和管理实验。本文是前端、后端、Agent共同执行的数据库设计；实现状态与目标设计分开。

## 1. 唯一权威：一个profile数据库，不建设第二套学生状态

学生端链路：`桌面主进程 → stdio RPC → 本地宿主 → 用户目录profile.sqlite`。

管理端链路：`管理界面 → 管理API → 中央PostgreSQL/评测执行器`。

- 本地宿主是用户正式记录的唯一写入方；模型与工具只产候选，renderer不直接写库。后端的本地业务repository由宿主在同一连接/事务中调用，不能另起进程或库维护第二份权威状态。
- 用户profile与只读安装资源分开。当前正式运行时使用schema v3和17张`local_*`表，实现在feature/agent；必须保留其围栏、任务、记忆、预算及回执语义。
- feature/db的24张规范化本地表属于待接入的业务扩展/查询投影设计，**不是现有profile的替换schema**。在空内存库执行DDL成功，不表示旧数据已迁移、repository已接入或可用于客户端。
- 中央不直接查询本机SQLite。只接收用户单独授权的必要脱敏副本，云端样本不反写本机原答、评分或记忆。首版可人工导出/导入，不建设通用跨设备同步。

## 2. 表和对象的责任划分

| 对象 | 现有权威/设计位置 | 接入要求 |
| --- | --- | --- |
| profile身份/所有权 | `local_control`，配合主进程账号绑定 | owner/fence/lease每次写事务检查；远程账号不是本地userId的替身 |
| 正式会话/工作流 | `local_sessions.workflow`和storage_version | 包含题答、状态和收尾依据；不允许interview_session.state与其分别独立更新 |
| 跨会话记忆 | `local_memory` | 按profile/岗位持久化，版本与证据兼容规则保留；skill_profile不替代记忆快照 |
| 任务/事件/幂等/提交回执 | `local_jobs`、`local_events` | operationId、请求摘要、ticket、snapshot、receipt和seq保留；查询投影可重建 |
| 会话额度/LLM授权及对账 | `local_session_budgets`、`local_live_grants`、`local_model_checkpoints`、`local_live_reconciliations`、`local_budget` | 固定总额度、CAS、reserve/dispatch/unknown及证据回执保留，不用token统计表替换 |
| ASR/TTS/共享子额度 | `local_resource_budgets`、`local_speech_*` | capability/grant/call/确认/重试关联保留，与LLM共受会话总额约束 |
| XP/金币、提示领取、学习事件、预测/复测配对 | 同一profile内新增业务表 | 后端定义规则，宿主幂等事务提交；不能只存余额或hints_used计数，须关联操作/回执 |
| 画像/成长、逐轮评分、报告、反思的展示查询 | 从已提交权威记录生成本地投影 | 记录source revision/digest与投影版本；可重建，不能反向改写原记录 |
| 内容/策略本地安装记录 | 同一profile增加版本化安装/采用记录 | 包版本、manifest摘要、兼容版本、安装状态和会话pin；更新失败保留旧包 |
| 账号/权限、团队知识/rubric/资源、审核/发布 | 中央PostgreSQL | 管理API鉴权和事务；内容版本/摘要不可被新内容覆盖 |
| 授权样本、数据集、实验执行/结果、监控/审计 | 中央PostgreSQL | 只保存授权副本，记录来源、分组、标签性质、执行预算；监控只读 |

规范化本地表的处理清单：

- `interview_session/turn`、`evaluation/dimension`、`interview_report/report_dimension`、`skill_profile/observation`、`reflection`先作为读取投影，保留原始workflow/记忆作为重建依据。
- `agent_run/run_attempt/run_event/plan_decision/idempotency_record/budget_ledger`只可作为诊断/展示投影，**禁止作为新的执行队列、提交回执或收费账本**。接线前明确到local_jobs/events/checkpoints的映射；不能仅把状态重命名后切换。
- `learning_progress/recommendation/prediction_snapshot/performance_pair`与`user_gamification/xp_event`可成为新增业务记录，但须保留学习事件、冻结预测/参考依据、操作幂等、辅助作答和版本信息；当前定义仍不足以代表业务协调器已交付。
- `audio_asset/transcript/audio_analysis`只存实际存在的元数据/确认记录；原始录音默认有界内存，不因storage_key字段要求而伪造文件。只有明确留存需求及同意后才另设计落盘。

## 3. 身份、内容与状态

### 3.1 本机身份与账号

远程app_user/auth_session由中央管理，本机profileId保持稳定。主进程维护profile与账号的显式绑定；账号退出不删本地数据，换号不能静默占用旧profile。本期不共享跨设备钱包。绑定/换号实现前不宣称当前default profile已具备多账号隔离。

本地表不建指向服务器的外键。**本机内部关联仍须保证**：turn→session、dimension→evaluation、report_dimension→report、transcript→audio等使用本地外键或等价的受测事务约束；启用foreign_keys，不把“无跨库外键”误写为“本机所有表都无关联约束”。

### 3.2 三种状态不能混用

- workflow phase是`ready_to_plan/awaiting_answer/ready_to_close/completed`。
- 本地任务是`queued/running/completed/failed/cancelled/interrupted`，candidate-ready为持久候选事件，不是正式提交。
- 规范化页面状态及旧HTTP事件仅是投影。必须给出版本化映射，不能按旧run_status CHECK拒绝本地interrupted，也不能以SSE序号替代本地job/seq。

revision/storage_version/业务operationId/通信request.id分别保留。旧attempt、取消或过期票据不能提交；提交事务同时写workflow、必要记忆、回执和完成事件。需要发放奖励时也以业务操作幂等关联，不能靠界面看到completed再任意加币。

### 3.3 内容与策略采用

会话固定岗位、知识包/题目、rubric、策略与其版本/摘要或完整快照。服务器同ID新版本不能改变历史报告。离线缺知识不能临时查云端最新值后把它写成旧版本。

中央policy_version发布状态、客户端安装状态、当前会话采用分别记录。单行adoption_status最多作兼容摘要，不能代表所有设备已采用；正式采用证据需profile/安装实例、版本/摘要、回执时间，并与会话pin关联。现有字段不是完整分发协议。

## 4. 预算、学习与数值不变量

- 额度按真实session固定，区分LLM/ASR/TTS、grant/call/attempt、金额整数单位/币种/费率版本与token。reserve/dispatch先持久化再联网；unknown保留预留，续授权/重启不能清零。budget_ledger统计不足以代替现有账本。
- 存零分必须同时`score IS NOT NULL AND score=0`；缺证据/弃评为NULL并记录原因，不能利用SQLite CHECK遇NULL的放行语义。
- 配对分数/误差在[0,1]；合格配对的绝对误差须与`abs(predicted-reference)`一致，具备冻结预测、参考来源/审核、学习暴露、岗位/技能/难度/rubric及时间窗。数据库算术约束不替代完整资格判定。
- hint_used只扣币，不能同时涨经验；计数不代替提示版本/领取/扣款回执。余额与账本同事务，重放不重复扣奖，复测不叠加普通面试奖励。
- 反思比率保存分子/分母和来源revision/digest，零分母为NULL；不能只留小数后宣称已可审计。画像投影不增加独立证据，重复题/辅助回答单独处理。

## 5. 授权回传与中央管理库

中央目标25表管理域划分已在feature/db提出；master仍保留历史44表模型，不能根据master旧表给服务器恢复学生主流程。授权样本/反馈至少关联：授权范围及版本、最小化字段与脱敏版本、稳定源ID和摘要、幂等键/接收回执、来源组与真人/合成、AI标签/独立人工参考、删除/撤回范围。authorization_ref文本存在不等于授权已验证。

管理端指标必须有来源/时间窗/版本及分子分母；不足显示未就绪。实验冻结数据集、标签、配置和预算，失败保留；通过不等于发布。首版不自动上传原音频/全部答案，不接收个人模型Key，不由管理端直接写本机记录。

## 6. 迁移：保留历史，不能直接覆盖

### 6.1 本地profile

现有v3及其备份升级由本地宿主管理。24表初始DDL只允许在隔离空库验证，不能对profile.sqlite直接执行。接入计划必须做到：

1. 宿主持有profile租约，用同一连接备份并校验版本/摘要与完整性。
2. 显式新增profile版本与扩展迁移；旧local_*权威、unknown费用、记忆、任务/事件和幂等回执不变。
3. 以已提交源记录填充投影，保存源revision/digest；不把缺失值变0或把draft/合成升级为正式真人记录。
4. 验证行数/摘要、foreign_key_check和业务不变量后提交；失败回滚DDL/版本并拒绝启动，不覆盖用户库或自动重跑模型。
5. 重启读取、完成/中断任务、回执重放、旧围栏、LLM/ASR/TTS未知消耗、同岗记忆和重复扣奖均通过回归后，才能称接入完成。

当前这条迁移与repository接线**尚未实现**；不能把Drizzle生成、空库DDL或本地schema行类型当作已完成迁移。

### 6.2 中央PostgreSQL

旧44表baseline曾用于开发库，新25表baseline不是其增量升级。不能替换0000后对旧库直接运行migrate，否则会重建同名表或丢失迁移来源。旧baseline保留归档；新管理baseline仅用于经核验的空库，已有旧表/旧journal须拒绝并提示先备份/制定数据转换。

已应用的新迁移也不改写，修正约束生成追加迁移。旧44表库若需升级，另交付数据导出/映射、账号/审核保留和授权数据处理方案；不能自动drop学生表，也不能默认把全部历史学生数据上传或复制到中央管理库。

## 7. 实现与验收责任

| 工作 | 负责人 | 验收产物 |
| --- | --- | --- |
| 本地扩展/投影schema与repository、中央管理模型 | 后端 | 与既有local_*映射清单；约束/迁移实际执行测试 |
| profile升级、事务围栏、任务/记忆/预算兼容 | Agent＋后端 | 旧v3备份升级、重启/幂等/unknown不丢失的集成测试 |
| 主进程账号/profile绑定、显示与设备 | 前端＋后端 | 换号隔离、受限RPC、真实状态与错误处理；不直写SQLite |
| 内容采用与授权导入 | 三人 | 版本校验、失败保留旧包、最小授权样本和回执 |

本次修正覆盖设计、约束反例和迁移准入保护；不代表已在部署PG或用户profile执行迁移。实际命令和测试以feature/db的package.json及对应记录为准。产品验收见[验收计划](evaluation-plan.md)，本地接入见[协议](local-runtime-api.md)。
