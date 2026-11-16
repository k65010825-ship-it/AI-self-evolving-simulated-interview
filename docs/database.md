# 数据库设计 v0.2

范围：数据按归属拆为两套库。**本地 SQLite**（`packages/local-db`）保存用户面试运行与能力画像数据；**服务端 PostgreSQL**（`packages/db`）只保存管理域正式数据。需求以 [PRD](prd.md) 为准，HTTP 对象见[接口文档](api.md)。表结构真值分别在 `packages/db/src/tables` 与 `packages/local-db/src/tables`，迁移分别位于 `packages/db/drizzle` 与 `packages/local-db/drizzle`，均由 `drizzle-kit generate` 生成，**未在部署实例执行过迁移**。

## 1. 边界

- 管理端 PG 不保存学生侧运行数据；`interview_session`、`interview_turn`、`plan_decision`、`agent_run`、`run_attempt`、`run_event`、`idempotency_record`、`evaluation`、`evaluation_dimension`、`interview_report`、`report_dimension`、`learning_progress`、`recommendation`、`audio_asset`、`transcript`、`audio_analysis`、`prediction_snapshot`、`performance_pair`、`reflection`、`xp_event` 与能力画像都在本地 SQLite。
- 本地 SQLite 不建服务端外键：`user_id`、`role_id`、`skill_id`、`question_id`、`resource_id`、`policy_version` 等只存标识文本；管理端导入样本同样不通过外键引用本机 `interview_id`。
- `packages/contracts` 的 Zod schema 仍是跨服务真值；`questionType`、`reviewStatus`、Run 事件类型等枚举与契约一致，由 `tests/db-schema.test.ts` 守护。
- 主键是不透明 `text` 标识（`run_event.id` 例外，用自增整数保证写入顺序）；不使用可被客户端解析的前缀语义。
- 分数统一 [0,1]；缺少证据时为 `NULL` 而不是 `0`。本地 SQLite 用 `real` 存分数，PG 用 `numeric(5,4)`；repository 负责类型转换。

## 2. 服务端表分组（PostgreSQL，25 张）

| 分组 | 表 | 说明 |
| --- | --- | --- |
| 身份 | `app_user`、`auth_session` | 账号 `account_role`（`student`/`admin`）与账号状态；不再保存 `xp`/`level`/`coins`（本地账本负责）；refresh token 只存哈希、轮换族与吊销时间 |
| 岗位与知识 | `job_role`、`role_skill`、`knowledge_source`、`rubric`、`rubric_criterion`、`knowledge_item`、`knowledge_item_source`、`knowledge_review` | 岗位表改名 `job_role`，与账号 `account_role` 不再同名同义；版本化 rubric（含 `content_hash`）与题库；`rubric_criterion` 承载 `dimension`/`anchors`/`evidence_rule`/`verification_goal`；审核记录绑定 `target_type`/`version`/`content_hash` |
| 策略版本 | `policy_version` | 白名单参数库内校验；候选生命周期 `status` 与 `publication_status`（发布）、`adoption_status`（客户端采用）三态分离 |
| 学习内容 | `learning_resource`、`learning_resource_skill` | 管理端学习资源与技能多对多；学习进度与建议在本地 |
| 进化 | `eval_dataset`、`eval_case`、`eval_experiment`、`experiment_case_result`、`experiment_execution`、`policy_champion` | 评测集分组隔离、冻结含题答/标签的 `content_hash`；`eval_case` 区分同源组、真人/合成来源、标签来源与授权依据；实验绑定不可变数据集版本/摘要与 `config_digest`，并有独立执行授权与预算 |
| 分发 | `content_release` | 轻量内容发布包：版本、`manifest`、摘要、状态与资源位置，客户端可下载、校验、固定版本、失败保留旧版 |
| 运维 | `audit_log`、`feedback_entry`、`alert`、`metric_snapshot`、`metric_measure` | 审计轨迹、反馈回流、告警流；指标快照带分子/分母/时间窗/来源/真实-合成标记/适用版本 |

## 3. 本地表分组（SQLite，24 张）

| 分组 | 表 | 说明 |
| --- | --- | --- |
| 能力画像 | `skill_profile`、`skill_observation` | 本机技能画像与逐条观察证据；`mastery` 缺证据为 `NULL`、`confidence` 缺证据为 `0` |
| 游戏化 | `user_gamification`、`xp_event` | XP/金币余额与按 `dedupe_key` 幂等的账本；`level` 由 XP 推导，不另存 |
| 面试 | `interview_session`、`interview_turn`、`audio_asset`、`transcript`、`audio_analysis` | 会话状态机与 `session_version`、逐轮题目快照与回答、音频原件、ASR 原文/确认文、声学与情感特征 |
| 任务与预算 | `agent_run`、`run_attempt`、`run_event`、`plan_decision`、`idempotency_record`、`budget_ledger` | 任务/租约/尝试/事件序号；选题动作与简短依据；提交幂等；预留/派发/结算/unknown 与对账的预算闭环 |
| 评估与报告 | `evaluation`、`evaluation_dimension`、`interview_report`、`report_dimension` | 每轮一评；`scoring_status` 与分维 `status` 区分计分、缺证据、弃评、零分；`answer_digest`/`answer_version` 固定被评回答版本 |
| 学习 | `learning_progress`、`recommendation` | 学习进度与建议绑定岗位技能 |
| 反思与配对 | `reflection`、`prediction_snapshot`、`performance_pair` | 复盘指标、预测快照（看到复测前固定）、合格/不合格配对及 MAE |

## 4. 关键不变量

1. **幂等提交**：本地 `interview_turn` 的 `(interview_id, idempotency_key)` 部分唯一索引保证同一会话不落两次正式回答；`idempotency_record` 按 `(user_id, route, key)` 记录请求哈希，用于「同键同内容返回既有任务、同键异内容 409」。
2. **状态机与版本**：`interview_status`、`run_status`、`run_event_type` 与[接口文档](api.md)的状态清单逐字一致；`completed` 必须有 `completed_at`，`cancelled` 必须有 `cancelled_at`，`session_version` 非负。
3. **事件重放**：本地 `run_event` 的 `(run_id, seq)` 唯一，`agent_run.last_event_seq` 保存最后序号，支撑 SSE `Last-Event-ID` 补齐。
4. **任务预算闭环**：本地 `agent_run.budget` 记录限额，`budget_ledger` 按 `reserve/dispatch/settle/unknown` 记录预留、派发、结算与无法确认的用量并支持对账；`run_attempt.usage` 只记录调用后的用量，不替代预算闭环。管理端 `eval_experiment.execution_budget` 与 `experiment_execution` 为评测任务提供独立执行授权与预算。
5. **知识与审核**：`knowledge_item`/`rubric` 以 `version` 独立成行，`content_hash` 固定内容；`review_status = reviewed` 必须同时具备 `content_hash`（与 `reviewed_at`）；修改内容即新版本新行，引用仍指向旧版本，避免历史面试指向被改动的正文。`knowledge_review` 绑定 `target_type`（`knowledge_item`/`rubric`）、`version` 与 `content_hash`。
6. **评分未知与零分**：本地 `evaluation.scoring_status`（`scored/partial/skipped`）与 `evaluation_dimension.status`（`scored/zero/missing_evidence/abstained`）区分计分、零分、缺证据与弃评；分数可为 `NULL`，不默认补 0；`answer_digest`/`answer_version` 确保引文不指向修改后的回答。
7. **进化红线**：`eval_dataset` 冻结覆盖题答与标签（`content_hash`）；`eval_case` 记录 `source_group`、`label_source`（AI 标签不冒充专家参考）、`review_status` 与授权依据；`eval_experiment` 绑定 `dataset_version`/`dataset_digest`/`config_digest`，运行后不能改 `expected` 或门槛使其通过；`deployment_status` 默认 `not_published`，标 `published` 必须有批准人与批准时间；同一实验范围只能有一条未回退 champion。
8. **发布与采用三态**：`policy_version` 分开记录 `status`（候选生命周期）、`publication_status`（管理端发布）与 `adoption_status`（客户端已采用）；管理端发布不改变正在进行的本地面试。`content_release` 让客户端下载、校验、固定版本、失败保留旧版。
9. **指标口径**：`metric_snapshot` 记录 `data_source`、`evidence_kind`（真实/合成/混合）与 `applicable_version`；每个比率在 `metric_measure` 存分子、分母、时间窗与来源，不只存 `skill_coverage=0.82`。
10. **游戏化**：余额只在本机 `user_gamification`，`xp_event` 是带 `dedupe_key` 唯一约束的账本；奖励事件与业务操作幂等关联；`level` 由 XP 推导，避免 PG 与 SQLite 各自增减余额造成漂移。
11. **音频生命周期**：本地 `audio_asset` 默认客户端处理，不上传全部音频与转写；保留期必须来自听审同意；`audio_analysis.clarity_score`/`emotion_confidence` 未验证或缺失时为 `NULL` 且 `clarity_verified`/`emotion_verified` 为假，不默认记 0 展示成可信评估。

## 5. 迁移工作流

```powershell
bun run db:generate          # 服务端 PG：改 packages/db/src/tables 后生成迁移
bun run db:generate:local    # 本地 SQLite：改 packages/local-db/src/tables 后生成迁移
bun run db:check             # 校验 PG 迁移与快照一致
bun run db:check:local       # 校验本地迁移与快照一致
bun run db:migrate           # 需要 DATABASE_URL，应用到目标 PG
```

- 表结构真值只在 `packages/db/src/tables/*.ts` 与 `packages/local-db/src/tables/*.ts`；两个 `drizzle/**` 目录由 `drizzle-kit generate` 生成，不手改。
- 本地 SQLite 迁移用 `bun:sqlite` 在测试中离线执行；桌面端持久化运行时（Electron 主进程 Node 环境）仍待接入，schema 不依赖任何 Node 专属驱动。
- `drizzle.config.ts` 不内置口令：PG 配置先读 `DATABASE_URL`，没有则自动加载仓库根目录被 git 忽略的 `.env`（模板见 [.env.example](../.env.example)）。

## 6. 当前验证状态

已验证（离线，`bun test`）：

- `tests/db-schema.test.ts`：服务端 25 张、本地 24 张表齐备；`role`→`job_role`、`app_user.role`→`account_role`；契约枚举一致；服务端不再含学生侧表；本地含幂等、预算账本、评分状态与画像表；两份迁移 SQL 覆盖各自全部表。
- `tests/db-migration.test.ts`：在 PGlite（PostgreSQL 17 WASM）中实际执行 PG 迁移，断言账号角色、知识审核绑定版本/hash、champion 回退、参数白名单、实验授权与预算等约束真实生效。
- `tests/local-db-migration.test.ts`：在 `bun:sqlite` 中实际执行本地迁移，断言状态机、幂等、事件序号、预算闭环、游戏化账本、评分零分/缺证据区分等约束真实生效。

未验证：在部署用 PostgreSQL 上执行迁移、种子知识导入、repository/事务实现、桌面端本地持久化运行时、备份恢复、并发与负载。构建或迁移生成通过不代表这些已完成。

## 7. 待定

- 题库/rubric 从 `knowledge/*.json` 导入数据库的脚本与幂等策略（当前仅校验结构，未入库）。
- `run_event`、`metric_snapshot`、`audio_asset` 的留存与分区策略。
- 桌面端画像文件的格式、备份与清除策略，以及删除请求如何同步清理本地画像和云端报告。
- 行级安全（RLS）是否需要，以及管理端导出与脱敏规则。