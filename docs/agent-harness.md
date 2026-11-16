# Agent Harness：Pi 主运行时与宿主确定性控制

## 运行时选择

项目只使用已固定的Pi SDK 1.4.0。Claude Agent SDK仅为机制参考，没有安装第二运行时，没有使用Claude订阅/凭证，没有为本次重构发出付费请求。借鉴的是钩子、技能与侧链边界，业务状态、统一额度、恢复和正式提交继续由宿主负责。

官方资料：[Claude hooks](https://code.claude.com/docs/en/agent-sdk/hooks)、[Claude subagents](https://code.claude.com/docs/en/agent-sdk/subagents)。Pi接口以安装包`dist/index.d.ts`、`dist/core/session-manager.d.ts`、`docs/sdk.md`为准。

## 七项机制与代码入口

|机制|实现|约束|
|---|---|---|
|完成门控|`harness/completion-gate.ts`、`adapters/pi/session-factory.ts`|真实SDK消息、工具回执、settled与宿主schema校验全部通过才返回；停止事件不是业务提交|
|分阶段上下文|`context/build-context.ts`、`context/wire-context.ts`|正式证据不变；规划做相关性/预算投影，评分剥离历史画像；wire预处理→auto阈值→reactive超限恢复|
|分支恢复|`harness/recovery-tree.ts`、`adapters/pi/evaluator.ts`|请求局部SessionManager检查点与append-only分支；失败历史仍在树内，重试上下文不带失败输出|
|扩展分类|`harness/profiles.ts`|skill / tool-source / hook / sidecar；tool-source区分local与MCP，当前仅真实local知识源，无MCP服务集成声明|
|技能按需加载|`harness/skills/*.ts`、`createSkillCatalog`|启动可列元数据，阶段首次请求才dynamic import正文；成功Promise共享缓存，加载失败移出缓存允许重试|
|侧链隔离|三个Pi适配器与`createHarnessPiSession`|每次新SDK会话、明确工具白名单、空资源发现，仅返回校验后数据副本；不合并子会话全文|
|可组合宿主harness|`createHarnessPiSession`、`HarnessHook`、`LiveModelDependencies.wireCompactors`|宿主注入有界验证钩子/工具实现/压缩器，强制阶段权限与核心门控；模型不能安装扩展或扩大权限|

## 完成门控的准确含义

`PostToolUse`发生时工具已执行，不能撤回外部副作用；`Stop`钩子在Claude SDK中的异常/超时也不一定阻止结束。因此本项目不将这些名字当成安全保证。

工厂订阅真实Pi事件，CompletionGate维护待完成工具集合、最终assistant、settled和不可复位的失败位。未知工具、缺start的回执、工具错误、取消、非stop最终消息均不能放行；原适配器继续限制输出长度和等待时间。适配器先解析schema/引语/选题约束，再通过`gate.accept`返回数据。下游仍须领域评分、引用支持校验及API的归属/版本/CAS事务；门控不会认证模型语义正确。

可选`HarnessHook`由受信宿主代码注册，最多8个、唯一ID。postToolUse读取回执副本，stop读取校验结果副本；异常拒绝结果，不能被观测日志吞掉。这些验证函数要求同步、有界、无网络/模型/副作用，Promise结果被拒绝。它们不是操作系统沙箱，不能终止恶意宿主函数的CPU循环。

## 会话树与错误恢复

每个评分请求创建独立内存SessionManager，写入只含请求摘要的checkpoint。格式/结构失败且原策略允许修复时，先复核原期限、取消及预算，再从checkpoint调用原生`branch`，追加恢复元数据并创建新的SDK会话。失败分支条目保留；下一次只提交原始题/答/量规，不把模型错误输出或工具副作用重新播放。

这相当于`/tree`的SDK分支能力，不在面试HTTP服务执行交互命令，也不是自动回滚数据库。树仅是请求内诊断状态，进程重启仍靠既有持久任务/事件/预算账本恢复；unknown消费无证据不重试。`onBranch`只输出分支ID和尝试计数，不输出原答/错误全文；观测回调异常不能改变业务结果。

## 压缩插件与漏斗

`prepareWireContext`的默认阶段是可选记忆去重，再删除可选记忆；auto达到阈值执行并可在已降到阈值下时提前停止，reactive收到真实context overflow后执行受控管道。`WireCompactor`只能选择原有memory的有序子序列；不能生成、修改、重复、重排证据。仅已知规划JSON可进入该通道，其他JSON不猜测结构；系统、当前答、量规、tools、tool_call_id与工具回执均不改。

host可通过`LiveModelDependencies.wireCompactors`替换阶段，仍受相同校验；到不了窗口预算则CONTEXT_BUDGET_EXCEEDED。字节估算不是供应商token保证；保留真实overflow恢复。模型摘要会带来新增调用、丢失细节与证据漂移，当前没有为此额外启用LLM摘要或Pi隐式auto compaction。输出截断继续由原调度器控制提额/重生成/续写，统一预算不会因分支而重置。

## 验证入口与证据边界

`bun test tests/harness.test.ts tests/harness-compaction.test.ts tests/harness-recovery-tree.test.ts` 验证门控、钩子拒绝、懒加载、权限、受保护压缩和真实Pi本地provider的分支修复。全量交付命令仍为`bun run agent:delivery`。

本地固定provider不是在线模型质量评测；没有进行启动性能对比，不宣称量化提速。独立人工标签、知识批准、表达可靠性和真实RSI效果不会由机制重构自动通过。业务接口/桌面端没有为本次工作扩展。

## 面试业务的建设决策

最佳实践以本项目的两岗面试、证据评分、跨会话记忆、恢复与统一预算为目标，不以复刻通用编码Agent的功能数量为目标。三人团队应把工程复杂度用于业务必经控制与独立质量证据。

|能力|决策|业务理由与当前做法|后续建设触发条件|
|---|---|---|---|
|PostToolUse/Stop|必须强制业务校验，已补齐|工厂强制装配business-guards；规划回执校验岗位/技能/草案授权，最终题目绑定本次实际回执；评分/呈现输出按阶段契约拒绝错误数据|新增业务工具时补对应回执与结果绑定校验；不为凑钩子数量重复评分逻辑|
|可插拔压缩/漏斗|保留受保护投影，不增加LLM摘要|15–25分钟面试以累计状态、近期记忆和当前题答为输入；当前答案与评分量规不可因压缩丢失。既有auto/reactive已纳入预算|先测出重复超限且安全投影无法解决，再对可丢弃旁支材料实验摘要；必须评测事实保留、调用成本与取消|
|会话树与/tree|保留请求内分支，暂不建交互浏览/任意重放|学生需要会话可恢复与分数不重复，不需要像开发者一样编辑模型历史；既有持久任务/fence/幂等/unknown才是重启恢复依据|管理员排障确实需要分支材料时先提供授权、脱敏、限保留的只读诊断；外部调用不可随树导航重放|
|四类扩展与MCP|保留明确分类与代码白名单，不建插件市场|现有知识/资源/评分工具均受宿主管理；协议改成MCP不会自动提升检索质量。当前没有MCP服务或通用插件加载器|已有真实外部服务且MCP是其稳定接口时添加单一受控适配，统一身份/超时/预算/来源；不开放学生安装服务|
|技能渐进式披露|保留宿主按阶段懒加载，不让模型自行选评分策略|规划/评分/呈现阶段明确，宿主可确定所需技能；岗位知识查询已经由模型按需调用，满足业务自主性|业务出现无法由当前阶段/岗位确定的任务时再评估模型路由，必须限制技能集合并验证误选/提示注入|
|侧链子Agent|固定任务隔离足够，不建递归自主调度|先评分再更新状态再规划存在数据依赖，不能为并行拆出互相矛盾的面试官；独立会话已隔离提示与工具结果，仍共用预算|确有互不依赖的任务，且离线对照证明质量或延迟收益后再增加受限执行器，预先定义深度/并发/花费与结果契约|
|harness组合|保留代码级装配，补强默认校验与启动失败行为|阶段profile+固定工具源+mandatory guard+附加校验+压缩策略足以服务两岗位；无需热安装/卸载与任意跨项目脚本|出现实际第二产品或独立维护的扩展包，再抽离版本化注册接口；须有兼容检查、权限不可扩大及失败策略|

这些决策不降低赛题能力：规划仍依据累计能力状态，知识仍由Agent真实按需访问，记忆仍跨会话持久化，反思/RSI仍有独立链路。没有通用子Agent调度器不等于缺少Agent；增加模型裁判也不能代替独立评分参考。当前更应投入岗位内容审核、引用支持评测、自然追问与真实学习效果验证。

## 强制业务钩子的装配与校验职责

`harness/business-guards.ts`通过工厂无条件注册：

- planning要求宿主scope（岗位、计划技能、是否允许草案）。PostToolUse校验ToolReceiptSchema、来源覆盖及相同ID内容一致性；Stop校验PlannerResultSchema、回执集合与选中题目的正文/岗位/技能/难度/题型/来源版本。选择算法及askedQuestionIds过滤仍由原规划器负责。
- evaluation校验EvaluationOutputSchema。原题答引语、分值/量规计算、澄清/弃评仍由原领域编排执行；这里不新增模型语义裁判，不把schema通过当评分正确。
- delivery校验BridgeModelOutputSchema，摘录必须在原答中唯一出现并包含在承接语里。原题追加、表面策略与授权回退仍由原呈现链路负责。

内置ID不能被附加钩子覆盖，总数最多8；所有钩子ID/回调类型和业务scope在创建SDK前验证。额外钩子只能继续收紧校验，不能重新允许已拒绝结果。学生回答、模型参数和远程JSON均不能注册执行代码。同步钩子只适合有限本地校验；预算、网络调用和持久提交继续放在各自执行边界。

边界回归：`bun test tests/harness-business.test.ts tests/harness.test.ts`。本机注入provider/HTTP用于工程检查；没有新增真实付费调用。官方SDK提供可借鉴的[钩子机制](https://code.claude.com/docs/en/agent-sdk/hooks)和[子会话隔离](https://code.claude.com/docs/en/agent-sdk/subagents)，上述建设取舍是基于本项目业务的设计判断，而非SDK要求。
