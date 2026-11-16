# 跨会话记忆与上下文压缩

这是现有记忆、上下文和Pi规划模块的完善，未增加另一套Agent后端或数据库。沿用Craft历史快照参考的职责区分：共享契约在packages/contracts，记忆/上下文业务规则在Agent宿主，Pi适配只装配会话和消费载荷，正式归属/持久化/CAS仍归业务API。UI不控制工具权限，模型不能修改召回策略或历史成绩。

参考依据：本地Craft Agents架构Skill及其v0.15.6 / `8df01c5d0ac73c35add5954e6f190ce038d35845`抽样源码。其会话持久队列是产品历史保存，不等于本项目跨会话能力记忆；未运行上游应用，也未复制其JSONL写入策略。这里的证据召回算法属于本项目设计，不宣称Craft已实现同样算法。[上游会话队列](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/sessions/persistence-queue.ts)用于理解边界，非最新实现或崩溃安全背书。

## 完整证据与模型视图分离

appendMemory仍重验报告，只追加已完成会话的最小证据；restoreMemory仍校验用户/岗位与结构。startSessionFromMemory保留配置技能的完整priorEvidence，不将历史变成本场回答/版本，也不删除超龄或未召回证据。原有同题首条独立证据规则、置信度衰减与历史题排除不变。

新`recallMemory(memory,{userId,roleId,now,skillIds,policy})`在已授权快照上生成`uncommitted-memory-recall`：

- policy默认maxItems=6、maxPerSkill=2、maxAgeDays=90；上限分别30/5/3650天，maxItems允许0。
- 先按原时间和会话排序，同题保留首次锚点，后续重复不能刷新时间；再按技能和证据原时间过滤。
- 每技能内部按新近证据优先，按skillIds顺序轮流取，避免一个技能占满。超过每技能或总量限制分别记录原因。
- selected带题目/技能/原时间/量规版本/证据模式；excluded保留宿主可追溯引用与原因；askedQuestionIds包含完整历史题，不受召回/时效过滤影响。

输出是只读派生视图，不改变记忆版本/原数据；相同用户ID字符串校验不能代替API认证。离线证据仍标offline-fixture，兼容性未声明的旧状态继续使用启发式混合估计；严格声明也不是人工认可成绩。完整记忆仍最多20场、每场200观测，超限拒绝；正式长期保留、删除传播、数据库重启恢复尚未实现。

## 历史量规版本兼容

新场可由宿主在CreateInterviewState/StartSessionMemory.session（也包括学习目标请求的session）固定以下可选字段：

```json
{"historyCompatibility":{"id":"java-compat-1","mode":"strict","allowed":[{"skillId":"spring-transactions","rubricId":"java-scenario-transactions","rubricVersion":"bank-0.1"}]}}
```

示例只是声明格式，不代表该量规已经过兼容性审核。精确匹配skillId/rubricId/rubricVersion，不按semver、相同分值范围或技能名称推断等价。宿主应依据可信知识版本与实际审核选择白名单；模型没有修改入口。allowed最多200项、不可重复、state内技能必须已配置；严格空白名单表示所有历史暂不用于能力估计。白名单可以显式容许多个版本，但这种host-declared-unverified声明不证明心理测量等价或教学质量，同ID/版本的内容篡改仍须API/知识摘要另行验证。

兼容判定在完整历史的同题首锚点上固定，再决定其是否能用于估计/召回。严格策略的各入口按observedAt、sessionId、observationId升序确定同一锚点，同时间也不能因数组顺序让估计和召回选择不同版本。legacy估计保留原数组首条、召回保留原时间/会话稳定排序，不给旧状态悄悄换锚点。不能先移除旧不兼容分数、再让同题近期兼容版本或本场重答成为新独立证据；请用不同题获得新证据。未通过历史保留原分、质量、原时间、量规版本/模式，继续用于原题排除、记录追溯与报告rubricVersions，不进入mastery/confidence计算或逐题模型载荷；recall记录rubric_incompatible，askedQuestionIds不变。新场不同题观测继续按本场已校验量规进入估计，白名单仅约束跨会话历史。

缺少字段的旧状态不静默重算，保持legacy-unchecked原启发式；有历史的报告提示history_rubric_compatibility_not_checked。严格状态提示history_rubric_compatibility_host_declared，确有排除时加incompatible_history_excluded_from_estimates；报告保留全部原量规出处。策略存入state并随观测重放，不能在已评估轮次后只替换收尾state的策略。正式冻结和跨进程防篡改仍由API的版本/CAS/存储保证，JSON声明不是认证。

buildInterviewContext.audit.historyCompatibility及PlannerResult.contextAudit.historyCompatibility提供mode/policyId/sourceCount/eligibleCount/excludedCount、authority和compatibilityVerified=false；是兼容首锚条件下的原记录计数，含重复，不能当独立题数。scoring的逐题历史仍隔离。recallMemory单独读取快照时可显式传historyCompatibility；快照自身不存某一场兼容政策，同一原记录可以按新场策略重新派生视图而不覆盖历史。机器schema见evaluation-schemas.json的historyCompatibilityPolicy/historyCompatibilityAudit。

现有学习模块可通过buildPracticeGoals从完整记忆派生下一场复练目标，再由宿主建立任务/冻结预测；planRetestQuestion按冻结目标和核验记录规划不同题。它不改普通面试策略，也不自动创建/提交学习任务，详见[学习与复测](learning-retest.md)。

## 模型上下文

发送管道现分两层：原领域构建器负责字符预算、整条记忆投影与知识缩短；provider的prepareWireContext负责wire预检、显式阈值auto_compact和已知错误后的reactive_compact。估算为UTF-8字节数加消息包装余量，非实际tokenizer或供应商窗口保证；Pi内置自动compaction仍关闭。

wire只清空已知规划JSON的可选memory；skills/plan/policy、原题/回答/量规、system、工具调用/结果配对保留，不生成LLM语义摘要，不改完整宿主证据。阈值触发但无可裁项且必填载荷仍在窗口内可继续，超硬窗口拒绝；reactive无可移除字段不重试。更早的字符上限仍有效，不保证所有超限输入可恢复。

buildInterviewContext的questioning视图放固定规划策略、累计技能状态和有界历史/岗位知识。scoring视图使用独立固定评分策略，只含roleId、phase=scoring、完整answer{text,truncated:false}及固定空memory/knowledge；不含累计skills、goal、剩余时间、难度状态、追问深度、历史成绩或画像来源。当前问题和宿主量规由evaluateTurn另行传入，必要输入或完整回答超限仍报CONTEXT_BUDGET_EXCEEDED。

评分阶段所有可选知识均记录scoring_isolation，包括调用方标记为reviewed或显式允许draft的条目；权威评分要求来自本次rubric的描述/维度/证据规则/锚点，所需标准应由宿主明确配置在那里。知识压缩与相关性排序用于questioning，不用学生画像给评分器挑选辅助材料。buildInterviewContext的完整audit仍只在宿主，evaluateTurn发送给评分依赖的context仅promptVersion/systemPrompt/userPrompt，避免原历史数量、来源引用或兼容政策通过audit泄漏。

Pi适配器对ScoringPayloadSchema/ScoringModelInputSchema再次严格校验：旧完整画像载荷、未知字段、非空memory/knowledge、错阶段或truncated=true在调用provider前拒绝。适配器使用自身固定system策略、独立无工具内存会话；不转发调用方自定义system字符串或audit。模型消息仅有outputSchemaVersion、interview、question、rubric。生成契约在evaluation-schemas.json的scoringPayload/scoringModelInput；没有新业务HTTP或正式数据库写入。

两岗回归固定回答/问题/量规，改变历史分数、目标与可选知识，验证评分依赖请求及真实Pi本地provider的user消息相同，宿主历史原样保留且累积估计仍可不同。这是字段和确定性替身的数据流隔离；当前回答、问题或量规正文仍可能透露身份/含提示注入，不构成内容脱敏、真实模型公平/稳定性或语义评分正确性的证明。

历史载荷移除用户/会话/观测ID，只留规划所需证据字段。状态版召回按技能岗位相关性排序后轮流取；上下文构建器与Pi question-planner统一使用context/memory-view.ts的fitMemoryContext。先校验必要载荷，再按召回顺序尝试整条证据；当前条放不下记录context_budget，仍可尝试后续较短条目。不会截断证据字段或JSON，也不会从压缩结果反推能力。没有一次性向模型塞整份历史。

知识按当前技能、岗位相关性、审核状态、ID排序，不再依赖传入顺序。重复、草案未授权、技能不相关、条数或预算限制均有原因。每条文本先受maxKnowledgeCharacters限制，必要时二分缩小到可放入剩余预算的长度；默认最小80字符，实际下限不超过条目上限与正文长度。截断避免新产生半个UTF-16代理对，JSON由完整对象序列化，不直接切JSON。

记忆先于可选知识占用预算；宿主可将memoryRecall.maxItems设为0，让知识优先使用空间。maxKnowledgeItems仍最多3；allowDraftKnowledge仍默认false。上下文是有损派生视图，完整来源和证据保留在宿主，不把截断片段当完整知识。

审计包含实际system+JSON字符数、知识采纳/丢弃/保留长度、记忆原因计数和至多6条排除决策引用；其余仅计数，避免审计自身随4000条历史膨胀。buildInterviewContext.audit.memory还保存最多30条included{sessionId,observationId}供宿主映射原证据，不放进userPrompt。MemoryContextAuditSchema限定sourceCount=includedCount+excludedCount、includedCount不超过selectedCount、原因计数和等于excludedCount；策略whole-evidence-projection-v1。compaction.savedCharacters是知识正文原长与保留长之差的汇总，不是整个prompt的token节省；semanticSummary=false。当前按UTF-16代码单元计数，不是tokenizer、模型上下文窗口或输出token预算。没有调用LLM生成摘要，也没有自动打开Pi全局compaction。

PlannerResult.contextAudit为兼容性可选字段，实际执行模型规划时附characterCount/unit及上述纯计数memory审计，不带用户/会话/观测引用；时间/轮数结束而未建prompt时不返回该字段。它只度量初始system+user载荷，不包含后续工具返回/SDK包装；工具/输出仍使用各自预算，不能把它解释为整场会话token上限。累计skills、plan和历史已问题排除始终来自完整state，maxInputCharacters不会改变mastery、confidence或排题集合；规划时间推进仍可正常降低置信度和剩余秒数。

## 验证与边界

回归覆盖隔离/时效/重复不能刷新时间/技能平衡/不变性、预算/优先级/Unicode/完整评分回答，以及真实Pi SDK本地provider确实收到历史投影且未收到业务会话ID。现有两场记忆demo、完整workflow、CAS与报告继续回归；不是数据库持久化、真实模型质量或教学提升证明。

联合回归从两岗合成MemorySnapshot JSON恢复开始：100天前首答与近期同题重复、近期短板及另一技能强项 → 建立新会话 → 召回（老题年龄排除，重复不能刷新）→ 宽/紧预算视图 → 真实Pi SDK本地provider工具循环。验证紧预算可裁掉全部逐题历史，而完整技能估计、原题排除和宿主选题仍保留；评分模型不收到历史画像和逐题成绩，原回答完整；必要输入超限时providerCalls不增加。这里只验证确定性宿主及替身数据流，不能证明真实模型会读懂短板或引用正确。没有修改置信度公式、90天召回默认值或同题首锚规则。

运行`bun run agent:memory:demo`、`bun run agent:context:demo`和`bun run agent:delivery`。只使用离线fixture；正式公开业务接口仍501。机器契约见evaluation-schemas.json中的recallMemory/memoryRecall。
