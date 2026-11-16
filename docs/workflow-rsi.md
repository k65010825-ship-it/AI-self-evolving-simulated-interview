# 会话收尾与 RSI 离线实验

本模块把完整会话的反思候选送入可重复的策略实验，返回审计、解释与下一场策略固定值预览。入口是 `evaluateWorkflowRsi`，也可通过内部 runs 的 `rsi` 任务调用。输出始终是 `uncommitted-workflow-rsi`、`scope=offline-experiment`、`productionPublished=false`；业务 API 的正式策略发布、事务和存储仍待实现。

## 开发与演示

```powershell
bun run agent:rsi:workflow:demo
bun run agent:rsi:http:demo
```

两个命令均覆盖 Java 后端与 Web 前端；后者通过真实本机 TCP、服务令牌和共享客户端验证 HTTP/SSE，并重试已评测操作。模型输出来自本地确定性 Pi provider，真实模型调用数为零。

演示源使用独立、手工编写的合成三轮题目目录及工具回执，不代表真实检索或模型自主选题质量。生产知识种子仍为每岗四条。三轮集中考察同一技能，生成最大追问深度从 2 降为 1 的受限候选；源会话的策略固定值始终为 2。

## 输入与处理

跨服务真值见 `WorkflowRsiInputSchema` / `WorkflowRsiResultSchema`，机器契约见 [JSON Schema](workflow-rsi-schemas.json)。

| 字段 | 约束与含义 |
| --- | --- |
| identity / snapshot | 用户及岗位归属；必须是完整收尾的 Workflow，重新恢复并验证历史、报告与反思，不能直接提交独立 candidate |
| experimentId / registry | 完整实验快照，实验及岗位匹配；来源策略必须是该实验已知的完整版本 |
| expectedRegistryVersion / operationId | 乐观版本与业务操作标识；相同操作必须使用相同语义输入 |
| suite | 有候选时必需；独立 synthetic validation 集，至少四例、两个组，包含收尾与轮数预算守卫 |
| developmentGroupIds / developmentSessionIds | 调用方完整声明的开发来源；宿主自动补入当前来源组、当前会话及画像引用的历史会话；合并后各最多 100 项 |
| nextSessionId / now | 下一场预览身份及宿主时间；下一场不能复用当前或已有画像历史会话 ID，不允许未来时间 |

先验证与恢复来源，再确定受限候选、隔离数据和调用既有实验注册表。无候选跳过评测且不增加版本；合法但未改善的候选留下 rejected 审计；数据泄漏、来源篡改和版本冲突直接失败，不生成成功候选。取消和截止检查覆盖各阶段；独立函数默认十秒预算，不能中断已经运行中的同步 CPU 片段。

调用方仍须保证未包含在快照中的开发组/历史来源清单完整，以及服务权限和快照来源可信。结构恢复与一致性校验不等于外部来源认证。

## 指标与解释

当前指标只有 `synthetic_action_skill_agreement`：规划动作与目标技能是否同时符合手工标注。演示固定四例，基线 2/4=0.5，候选 4/4=1，差值 0.5（50 个百分点）。这是合成决策回归结果，不是实际追问命中率、评分校准、真实题目可用性或学生能力提升。

返回 `sourceMetrics`、参数 `changes`、评测分子/分母、隔离清单与 `explanation.trigger/decision/publication`，说明为何提出候选、为何接受/拒绝、何种发布边界。只有改善且无成对退化和约束违规时更新离线 active；原会话 pin 不变。

| status | 语义 |
| --- | --- |
| skipped_no_candidate | 无受限候选，evaluation 与 operationSeq 为空 |
| evaluated_activated_offline | 本次合法评测改变离线 active，尚未正式发布 |
| evaluated_rejected | 本次合法评测未达到激活条件，版本增加并记录拒绝 |
| replayed | 原操作已执行；appliedNow=false，返回当前注册表与下一场预览 |

重放时 `recordedOutcome` 是历史结果，不能据此推断当前 active。回滚后重试旧操作，即使保留原 `now` 和旧 expectedVersion，也不会重新激活历史候选；预览 pin 时间取原操作时间与当前注册表时间的较大值。同一 operationId 修改评测内容则冲突。新操作仍必须符合当前版本及单调时间。

## 内部 HTTP 与后端协作

POST `/internal/v1/runs` 的 `job={type:'rsi',input:WorkflowRsiInput}`；根 context 身份必须与 input.identity、snapshot.identity 一致，registry 岗位也需一致。沿用服务令牌、2MiB 请求上限、32 个保留任务/4 个活动任务、运行截止和取消语义。202 表示接受任务；从 GET 终态读取完整 result，检查 kind 及 committed=false 后再由业务 API 做权限、CAS 和事务提交。

`rsi.completed` SSE 只包含 sessionId、experimentId、status、registryVersion、synthetic 标记、productionPublished=false 及 baselineAgreement/candidateAgreement/delta（可为空）；不广播答题、题库、验证案例或完整注册表。SDK `executeRun` 校验 rsi 对应结果 kind；网络重试与业务 operationId 重放是两层不同机制。

演示的 registryCandidate 和 nextSessionPin 均为返回值，服务不写正式表、不修改传入快照、也不自动把预览用于另一场面试。正式发布需要业务端独立授权与原子版本提交。

## 验收范围

回归覆盖两岗链路、普通无候选、合法拒绝、来源与历史泄漏、身份/版本/篡改、回滚后旧操作重放、取消/截止、HTTP 最小事件与 SDK 本机 TCP。尚未验证真实模型策略效果、真实语音、跨进程持久恢复、数据库提交与学生学习收益。
