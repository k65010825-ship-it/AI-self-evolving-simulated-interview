# 受约束的知识规划Agent

## 难度递进与历史兼容

新建本地会话使用local-v2策略，显式固定`difficultyProgression=independent-evidence-v1`。只有当前技能仍被累计状态选中、掌握度≥0.8、置信度≥0.6、剩余至少180秒，并且本会话最近两道独立新题都达到当前难度、得分及证据质量≥0.8、题型不同，才请求提高一级，最高5级。时间/轮数/连续追问上限优先；一次高分、重复题、历史题、低难度证据不能连续推高难度。题库仍按最接近的可用难度提供原题，计划难度不保证题库有精确匹配，不伪造新题或新量规。

该字段可选且没有缺省注入；旧策略继续原算法，不在恢复时重写历史nextAction。profile仍为v3，没有DDL或repository迁移。阈值是有界教学规则，离线通过不证明学生能力校准或真实教学效果。

## 能力与边界

createPiQuestionPlanner使用独立Pi会话，让模型根据累计技能估计与宿主计划发起知识查询，提出真实回执中的题目ID。宿主仍决定目标技能、节奏和候选接受规则；不是让模型自由改策略或生成任意问题。初始提示只有状态估计、目标与策略，没有整份题库。

本地确定性provider验证工具循环；2026-11-04另在明确授权下使用qwen3.8-max通过两岗合成回答的真实知识工具与候选选择小样本，见[模型接入](model-access.md)。这不证明普遍检索质量、抗提示注入或教学效果。模型/凭证仍由宿主显式注入，不发现个人配置；默认评分会话仍无工具。

## 使用与契约

`bun run agent:planner:demo`演示两岗独立规划；`bun run agent:planner:runtime:demo`演示两岗本机HTTP/SSE、单轮评分、查询选题与报告。真实模型调用0，所有结果未提交。

服务默认确定性选择。启用时同时设置AGENT_MODE=offline-fixture、独立AGENT_INTERNAL_TOKEN和AGENT_PLANNING_MODE=pi-knowledge；缺省planning为deterministic。正式业务API仍501。

公共真值packages/contracts/src/knowledge-planner.ts，机器定义[planner-schemas.json](planner-schemas.json)随openapi:generate同步。PlannerInput包含state/context/goal/askedQuestionIds，可选planningPolicy，allowDraftKnowledge默认false。岗位不匹配先拒绝，快照真实性与身份归属由API确认。

## 模型与宿主职责

宿主先用累计状态和pin确定plan目标；finish不调用模型或工具。模型唯一工具query_role_knowledge参数为skillId、可选query、limit=1—3，不接受roleId/userId/purpose/URL/path。宿主注入当前岗位及questioning目的，skillId必须等于本轮host plan目标。

query是对题目/考点的字面子串过滤，不是语义搜索；描述现已在共享schema与工具说明中明确。首查提示模型仅传skillId/limit并省略query，后续只有从已有回执中观察到的短语才用于收窄。该要求是工具使用指导，不是新增授权边界；执行器仍严格按实际参数过滤，空结果不自动全库回退、不伪造命中。

模型选择查询内容、是否继续查询及提出questionId。实际createKnowledgeExecutor回执再过滤审核态、已问题、历史题与技能构念。draft仅在显式允许时返回。模型最终严格输出`{questionId:string|null}`；非收尾必须实际查询过。真实空结果允许unavailable，没查过、凭空ID或越权则拒绝。

宿主合并成功回执可用记录，按当前状态、pin、最近难度与ID排序做确定性选择，模型ID须与其一致。只返回原题及源量规，不接受改题/改权重。结束时若进入宿主收尾，以收尾为准。正式发题仍需API版本检查与CAS。

pi-knowledge模式读取宿主种子执行器，不使用job.knowledge选题；默认模式继续用job.knowledge。工具仅questioning用途，不是评分检索工具。当前种子两岗各四题且draft，缺少后续新题时明确unavailable。

## 隔离、预算与取消

每次全新内存会话、空资源loader，关闭retry/compaction，仅一项工具白名单。先订阅再prompt，要求settled、未aborted、最终stop且无toolCall，并严格解析JSON。未知工具、截断、无回执或非法输出拒绝。

默认system+prompt最多12000字符、累计工具回执16000字符、输出2000字符；UTF-16预算不是token/费用保证。最多3次工具、4条assistant消息，单消息多个工具也计总数；默认10秒，受宿主和会话deadline约束。错误复用MODEL_OUTPUT_INVALID、VALIDATION_ERROR、TOOL_BUDGET_EXCEEDED、CONTEXT_BUDGET_EXCEEDED、RUN_CANCELLED、DEADLINE_EXCEEDED，原始SDK错误不透出。

外层竞速、AbortController和等待后复验拒绝迟到候选。finally清理timer/监听器并dispose，不等待可能无限阻塞的SDK abort→idle。依赖若忽略信号仍可后台工作，部署还需并发与真实网络取消验证，无收费停止或跨进程恢复保证。

## 运行结果

PlannerResult为uncommitted-knowledge-plan，含selection、receipts、modelMessages；宿主直接收尾可为0消息/0回执。内部turn结果可选planning，selection复用其校验候选。SSE形状不变，不发资料、原始SDK消息或思考。planning含量规资料，仅供内部后端诊断，不能直发renderer。

累计历史可改变host目标，进而改变模型实际查询技能；离线fixture按此目标调用工具，证明执行及状态驱动数据流。真实模型的检索相关性、查询策略与恢复质量仍待独立评测。
