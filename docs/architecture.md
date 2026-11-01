# 架构基线 v0.1

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

当前骨架只实现 /health、双岗种子知识执行器及工具适配、公共校验/错误、纯规划优先级示例、初始 schema、桌面安全桥接和静态启动界面。业务未实现入口返回 501；/health 返回 scaffold 状态，不代表面试服务已就绪。

## 数据概览

User → InterviewSession → InterviewTurn → Evaluation；Session → AgentRun → RunAttempt/RunEvent。RoleProfile → KnowledgeItem/Question/Rubric。User+Role+Skill → SkillObservation/Profile。Recommendation → LearningProgress → PredictionSnapshot/PerformancePair → Reflection → PolicyVersion/EvalExperiment。

骨架 schema 仅放基础表，完整状态机、迁移、事务和持久化属于后续任务。各实体明确区分：产品会话、SDK 上下文、任务执行与长期画像不能用同一份 JSONL 替代。

## 面试状态与规划

InterviewState 保存已测/待测技能、各技能 mastery/confidence、薄弱点、已练题、剩余时间、难度、当前追问深度；历史画像初始化后，每轮按新证据更新。不是仅靠聊天摘要或上一句关键词。

初始规则：mastery 是固定 rubric 下归一技能分的证据加权均值；confidence 综合有效独立题数、题型覆盖、一致性与时效，范围 [0,1]，表示证据可信程度，不是已校准正确概率。缺证据时 mastery=null、confidence=0；重复原题不增加独立证据数，冲突触发诊断追问。候选排序综合岗位相关度、低置信、薄弱与覆盖缺口；领域模块目前只实现基础排序，不等于完整规划器。

动作限定 deepen / switch_skill / adjust_difficulty / finish。模型依据累计状态选择知识和动作，程序约束时间、重复题、覆盖、追问深度与合法输出。保存简短依据与证据引用，不保存内部推理链。

目标会话状态：planning → awaiting_answer → processing_answer → awaiting_answer / completed；非终态可进入 cancelled 或 failed。目标任务状态：queued → running → completed / failed / cancelled。各轮和状态迁移在 API 内检查 sessionVersion；已完成会话不接受新答案。HTTP 数据对象见 [接口文档](api.md)。

## 语音与评估

原音频一条分支做 ASR，原始转写与学生确认文同时关联；内容评估使用确认文。另一条分支从原音频取得有声时长、停顿等特征和中文情感推断，支撑表达反馈。音频清晰度是待人工样例验证的可懂度估计，不能直接使用 ASR confidence 代替自信或发音评分。

报告区分技术正确性、深度、逻辑、岗位匹配、表达结构/沟通；语音才追加声学/情感维度。文字输入的音频维度为 null；噪声、过短、口音等情况标不足。TTS 播报问题与模型推理接口分别适配，不要求经 Pi 代理所有语音请求。

原音频默认处理/确认后删除；用于听审时单独告知并同意保留至交付后 7 天。删除后时间片段和统计仍可说明依据，但必须标不可回放。画像、报告与删除请求按所有权处理；日志不记录完整音频、简历或密钥。

## 反思与策略版本

每场反思先记录追问目标、新增证据、重复/漏测、时间与不确定性；无复测时等待后续数据。当前能力估计、学习增益和带学习条件/期限的未来成绩预测分开存储。PredictionSnapshot 在看到复测题/答案前固定，符合期限、难度、学习暴露和 rubric 的样本才进入 PerformancePair。

首版固定评分 rubric，候选只调整 uncertaintyPriorityBoost、maxFollowupDepth、coverageReserveRatio 等白名单参数，预设范围和单次上限，模型不能改发布门槛或权限。保留基线 v0；会话启动固定策略，正在进行的会话不随新版本变动。

自动门槛使用预标注分支场景和内部验证参考评分；通过后事务更新实验范围 champion，失败保留旧版。真人命中率独立盲审，不能把场景代理当真人效果。支持人工审计与回退，普通正式发布可另有管理员控制，但不能替代自动实验链路。数据门槛、预测字段和指标见 [评测计划](evaluation-plan.md)。

## 工程与交付约束

共享契约位于 packages/contracts；跨服务事件转换留在 Pi 适配层，前端不接 SDK 原始事件。Electron contextIsolation/sandbox 开启、nodeIntegration 关闭，preload 仅命名白名单方法，主进程验证发送来源。当前桥接只有版本与健康查询，语音权限仍默认拒绝。

创建/恢复 Pi 会话显式指定资源、工具、settings、session 和 runtime；不读取个人全局资源。凭证留在服务器，SDK 恢复不代表业务任务或外部副作用可恰好一次恢复。工具契约、预算与错误由 [tool-contracts.md](tool-contracts.md) 和 [error-handling.md](error-handling.md) 定义。

三人模块所有权、分周目标和 PR 流程见 [collaboration.md](collaboration.md)。签名安装包、非开发机测试、HTTPS、数据库备份/恢复须独立验证，不能用桌面构建通过替代。

不为了像 Craft 增加桌面内置服务器、双 SDK 或通用 SessionManager 巨类。
