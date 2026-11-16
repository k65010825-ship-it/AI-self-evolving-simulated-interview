# 数据库设计 v0.1

> 当前架构边界（2026-11-16）：以下是 master 已合入的**历史 44 表 PG 模型**，不再作为新产品数据所有权设计。学生正式会话、报告、记忆、学习/复测、任务、事件、预算与 XP/金币归本机 SQLite；中央 PG 仅负责账号、团队内容/审核、授权样本、管理评测与审计，见[架构](architecture.md)。下文“只有业务 API 拥有正式数据”只适用于旧服务，不能用于本地宿主。
>
> `origin/feature/db` 已提供本地 SQLite / 管理 PG 拆分和 `packages/local-db`（本次核对提交 `1bb3de3`），**尚未合入 master，也未与 feature/agent 宿主完成适配**。本轮仅更新共享文档，不复制该分支 schema、不改迁移历史。合入时由后端一并更新本文表清单和操作命令，核对已有 profile 迁移、unknown、租约、幂等回执与唯一写入方，不能新建一套库后称已有会话自动迁移。

范围：业务 API 的正式数据（身份、归属、面试、任务、评估、画像、学习、反思与策略实验）。需求以 [PRD](prd.md) 为准，HTTP 对象见[接口文档](api.md)，表结构真值在 `packages/db/src/tables`，迁移在 `packages/db/drizzle`。本文描述目标数据模型与已生成的迁移，**未在部署实例执行过迁移**。

## 1. 边界

- 只有业务 API 拥有正式数据、归属、任务和提交；Agent 不直写这些表（[架构](architecture.md)）。
- `packages/contracts` 的 Zod schema 仍是跨服务真值：表只是持久化，API 负责行到 DTO 的映射。`questionType`、`reviewStatus`、Run 事件类型等枚举与契约保持一致，由 `tests/db-schema.test.ts` 守护。
- 主键是不透明 `text` 标识（`run_event.id` 例外，用 `bigserial` 保证写入顺序）；不使用可被客户端解析的前缀语义。
- 数值分数统一 `numeric(5,4)`，取值范围 [0,1]；缺少证据时为 `NULL` 而不是 `0`。`numeric` 在驱动层是字符串，repository 负责转换。

## 2. 表分组

共 44 张业务表，另有 drizzle-kit 维护的 `public.__drizzle_migrations` 记录已执行迁移，不属于业务模型。

| 分组 | 表 | 说明 |
| --- | --- | --- |
| 身份 | `app_user`、`auth_session`、`xp_event` | 统一账号 + `student`/`admin` 角色、账号状态（`active`/`disabled`）与最近登录；`xp`/`level`/`coins` 余额与按 `dedupe_key` 幂等的经验/金币账本；refresh token 只存哈希、轮换族与吊销时间 |
| 岗位与知识 | `role`、`role_skill`、`knowledge_source`、`rubric`、`rubric_criterion`、`knowledge_item`、`knowledge_item_source`、`knowledge_review` | 两岗技能模块、来源登记、版本化 rubric（权重/满分锚点）、题库、来源引用、`draft → reviewed` 审核账本 |
| 策略版本 | `policy_version` | 白名单参数（`uncertaintyPriorityBoost`、`maxFollowupDepth`、`coverageReserveRatio`）在库内做范围校验；`baseline-v0` 为基线 |
| 面试 | `interview_session`、`interview_turn`、`audio_asset`、`transcript`、`audio_analysis` | 会话状态机与 `session_version`、当前题、累计 InterviewState（jsonb）；逐轮题目快照与回答；音频原件、ASR 原文/确认文、声学与情感特征 |
| 任务 | `agent_run`、`run_attempt`、`run_event`、`plan_decision`、`idempotency_record` | 任务/租约/尝试/事件序号；选题动作与简短依据（不含推理链）；回答提交幂等记录 |
| 评估与报告 | `evaluation`、`evaluation_dimension`、`interview_report`、`report_dimension` | 每轮一评；分维分数可为 `NULL`（信息不足不填零）；报告按会话唯一 |
| 画像 | `skill_profile`、`skill_observation` | 当前 mastery/confidence/证据数；逐条证据观察，重复原题不增加独立证据 |
| 学习 | `learning_resource`、`learning_resource_skill`、`learning_progress`、`recommendation` | 资源与技能多对多；完成状态区分 `self_reported` 与 `verified`；建议绑定岗位技能 |
| 反思与配对 | `reflection`、`prediction_snapshot`、`performance_pair` | 复盘指标、预测快照（看到复测前固定）、合格/不合格配对及 MAE |
| 进化 | `eval_dataset`、`eval_case`、`eval_experiment`、`experiment_case_result`、`policy_champion` | 评测集分组隔离、逐例结果、实验状态与发布状态、实验范围 champion 与回退历史 |
| 运维 | `audit_log`、`feedback_entry`、`alert`、`metric_snapshot` | 审计轨迹、学生反馈回流、告警流、监控快照 |

## 3. 关键不变量

1. **幂等提交**：`interview_turn` 的 `(interview_id, idempotency_key)` 部分唯一索引保证同一会话不落两次正式回答；`idempotency_record` 按 `(user_id, route, key)` 记录请求哈希，用于「同键同内容返回既有任务、同键异内容 409」。
2. **状态机与版本**：`interview_status`、`run_status`、`run_event_type` 与 [接口文档](api.md) 的状态清单逐字一致；`completed` 必须有 `completed_at`，`cancelled` 必须有 `cancelled_at`，`session_version` 非负。
3. **事件重放**：`run_event` 的 `(run_id, seq)` 唯一，`agent_run.last_event_seq` 保存最后序号，支撑 SSE `Last-Event-ID` 补齐。
4. **任务预算**：`run_attempt` 只允许 `attempt_no` 1—2，符合「每 run 最多两次尝试」；`agent_run.budget` 记录 LLM/工具/时限预算与已用量。
5. **知识与审核**：`knowledge_item.review_status` 只接受 `draft`/`reviewed`，审核动作写入 `knowledge_review` 且 CHECK 约束限定合法迁移（approve 只能 draft→reviewed）；rubric 权重 `(0,1]`、满分 `>0`，逐条权重和为 1 仍由导入脚本校验。
6. **证据与预测**：`skill_observation` 在 `independent_evidence` 为真时按 `dedupe_key` 唯一；`skill_profile` 有 mastery 时证据数必须 > 0；`performance_pair` 标 `eligible` 必须同时具备参考分、MAE、学习暴露匹配与复测会话，否则必须写明 `ineligibility_reasons`。
7. **进化红线**：`eval_experiment.deployment_status` 默认 `not_published`，标 `published` 必须有批准人与批准时间；同一实验范围只能有一条未回退 champion，回退行必须写明原因与前一版本，保留历史。
8. **游戏化**：`app_user` 保存当前余额，`xp_event` 是带 `dedupe_key` 唯一约束的账本；`hint_used` 只能是扣金币，其余动作为非负增加，避免刷分和重复奖励。
9. **归属**：所有学生数据表经 `user_id` 关联 `app_user`，面试子表通过外键级联；API 仍需在查询层校验归属，数据库约束不代替鉴权。
10. **音频生命周期**：`audio_asset` 保留期必须来自听审同意；`deleted` 状态与 `deleted_at` 互为依据，删除后仍可保留时间片段统计。

## 4. 迁移工作流

```powershell
bun run db:generate   # 改表后生成 SQL 与快照（packages/db/drizzle）
bun run db:check      # 校验迁移与快照一致
bun run db:migrate    # 需要 DATABASE_URL，应用到目标库
```

- 表结构真值只在 `packages/db/src/tables/*.ts`；`packages/db/drizzle/**` 由 `drizzle-kit generate` 生成，不手改。
- `drizzle.config.ts` 不内置口令：先读环境变量 `DATABASE_URL`，没有则自动加载仓库根目录被 git 忽略的 `.env`（模板见 [.env.example](../.env.example)）；两者都没有时只能生成迁移，不能执行迁移。
- 本地库可用 [infra/compose.yaml](../infra/compose.yaml)，也可用本机安装的 PostgreSQL；部署环境的备份/恢复与迁移执行属于独立验收项。

## 5. 当前验证状态

已验证（离线，`bun test`）：

- `tests/db-schema.test.ts`：44 张表齐备、契约枚举一致、幂等/去重/champion 唯一约束存在、迁移 SQL 覆盖全部表。
- `tests/db-migration.test.ts`：在 PGlite（PostgreSQL 17 WASM）中实际执行全部迁移语句，并断言状态机、幂等、事件序号、champion 回退、参数白名单、分数范围、游戏化账本等约束真实生效。

已验证（本机开发库，PostgreSQL 17.11）：

- `bun run db:migrate` 实际执行成功，得到 44 张业务表与 `public.__drizzle_migrations` 记录，重复执行不会重放。
- 约束冒烟检查（事务内插入后回滚，未留数据）：合法路径可写入；面试时长越界、金币为负、同会话复用幂等键均被拒绝。

未验证：在部署用 PostgreSQL 上执行迁移、种子知识导入、repository/事务实现、备份恢复、并发与负载。构建或迁移生成通过不代表这些已完成。

## 6. 待定

- 题库/rubric 从 `knowledge/*.json` 导入数据库的脚本与幂等策略（当前仅校验结构，未入库）。
- `run_event`、`metric_snapshot`、`audio_asset` 的留存与分区策略。
- 删除请求向音频、报告、画像传播的具体事务边界。
- 行级安全（RLS）是否需要，以及管理端导出与脱敏规则。
