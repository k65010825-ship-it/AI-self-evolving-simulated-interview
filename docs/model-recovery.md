# 统一重试、模型修复与错误恢复

上下文恢复默认漏斗已增加中间保留阶段：去重后保留前半段完整可选记忆，auto若已满足阈值即可停止，否则继续整段移除；reactive仍逐阶段清除可选规划记忆。必填内容、工具配对、原deadline和逐HTTP计费约束均不放宽。默认autoCompact仍关闭，需显式配置；现有注入式恢复测试不等于真实供应商成功率。

恢复已接入live manager的唯一HTTP边界及评分Pi适配器。默认仍是单次HTTP、模型修复关闭；不会重跑整个turn/workflow或自动增加预算。Agent已有受控SQLite运行记录，正式业务提交/CAS与生产部署由业务后端负责。

## JSON读取、本地格式恢复与诊断

评分输出统一经过 `apps/agent/src/evaluation/read-json.ts`。先按原文本JSON.parse；合法值保持原样再走业务schema，任意层级的重复键（包括转义后同名）拒绝，不能静默采用后一个分数或证据。键检测用迭代栈，不递归遍历深JSON，不执行文本代码。

outputRepair默认none；json-fence-only只允许移除一层完整、首尾锚定且标注json的对象围栏，保留内部全部字段/值。解释文字、多对象、其他围栏、残缺围栏、尾逗号和单引号都不修补，不提取“看起来像JSON”的子串。围栏内非对象拒绝；本地解包不会增加HTTP、工具或模型修复次数，仍须schema、引用、Stop及领域校验。

内部jsonIssue只记录固定分类，如fence-disabled、fenced-syntax、unclosed-fence、unsupported-fence、surrounding-content、invalid-syntax、unclosed-structure、non-object-root、duplicate-key。它不保存原始输出、解析异常、键或值；经Pi修复包装层及批次JSON/Markdown/重放保留。未闭合结构是文本事实，不能证明网络截断；SDK length结束另标generation-incomplete，即便可解析也不能采用，且不进入JSON模型再次生成。HTTP层已有的输出升级/续写仍走其独立有预算策略。

仅maxModelRepairs=1且授权、取消、期限、额度检查均允许时，JSON/schema拒绝可从原题答与量规独立重新生成一次，失败详情保留；不复用有歧义的输出值。证据/绑定拒绝不走此分支。冻结双岗批次允许显式本地围栏策略，但仍要求maxModelRepairs=0，不能因本地解包放宽付费次数或恢复上限。

离线专项：`bun --no-env-file test tests/json-output.test.ts tests/json-recovery.test.ts tests/json-batch.test.ts`。使用真实Pi SDK、注入HTTP/usage与SQLite，覆盖局部修复、重复键、取消、length、预算拒绝、计量和重放；不证明供应商格式或语义质量。

## 配置与覆盖范围

2026-11-05增加显式截断/上下文恢复：initialOutputTokens可选且不超过profile硬上限；maxOutputRecoveries=0/1、truncationMode=regenerate/continue、maxContextCompactions=0/1；autoCompact默认{enabled:false,windowTokens:131072,triggerRatio:0.8}。每次追加请求重新reserve/dispatch，按当前payload和输出cap检查窗口；不自动扩大预算。

共享真值为packages/contracts/src/model-recovery.ts，机器定义见[model-recovery-schemas.json](model-recovery-schemas.json)。供应商配置JSON新增recovery，默认值如下；启用时显式修改配置，不能靠模型请求或renderer开启。

```json
{"recovery":{"httpMaxAttempts":1,"maxModelRepairs":0,"baseDelayMs":250,"maxDelayMs":3000}}
```

httpMaxAttempts范围1—3，含首请求；maxModelRepairs范围0—1；baseDelayMs/maxDelayMs范围1—5000且后者不小于前者。SDK的自动重试保持关闭，避免两层重试相乘。HTTP恢复适用于共享provider中的评分、知识规划和承接语调用；模型结构修复当前仅支持评分，不覆盖规划器或桥句的业务语义错误。

## 错误决策

| 错误 | 动作 | 账本与结果 |
| --- | --- | --- |
| 明确HTTP 429/503，且httpMaxAttempts大于1 | 可等待后重试同一HTTP请求 | 每次新增reserve/dispatch，原请求记rejected并保留最坏token/费用 |
| 401/403、其他HTTP错误 | 不自动重试 | 维持原unknown保守占用，run失败；认证/额度需宿主处理 |
| 网络中断、超时、缺少/非法SSE usage | 停止自动恢复 | unknown留账，不假设免费；跨run闸门阻止继续派发 |
| 已结算输出无法解析JSON或不符合结构schema | 显式maxModelRepairs=1时最多独立生成一次 | 原输出照常计费，新调用继续同run预算，不退还已消耗额度 |
| 引用伪造/偏移失配、分数或量规不合法、证据不足 | 不通过模型修复兜底 | 原引用/算分规则拒绝；不得补0或编造证据 |
| 取消、总期限、权限撤销、超用锁定、预算不足 | 停止 | 不追加尝试、不接纳迟到成功，不生成假报告或观测 |

HTTP重试只有在尚未收到成功SSE响应前发生，不重放已执行工具。原请求在每次发送时显式clone，重新校验端点、授权、权限和预算。无重定向，不记录上游错误正文或凭证。

## 退避、Retry-After与期限

普通等待为有上限指数退避，使用0.5—1倍抖动；Retry-After支持秒数及HTTP日期，取不早于服务器要求的等待。服务器要求超过maxDelayMs或头超过128字符时停止，不能忽略长等待或截断后提前重发。无法解析的短头按普通退避处理。

等待可取消，且同时受run、临时授权及原模型调用期限约束；等待所需时间已超出剩余期限时直接停止。生成修复复用原总timeout，不能给第二次请求重新延长整轮任务。等待返回、生成返回及真正HTTP派发前再次核对；同步阻塞越过期限也不能返回成功。

## 保守预算与对账

rejected表示已收到明确429/503响应，本次HTTP不再占逻辑并发槽，但调用数、最坏token/费用继续保留。它与断网unknown不同，也不代表供应商没有计费。后续reserve同时计算已用和所有未对账预留，因此不会把拒绝的尝试当免费额度。

宿主拿到可信实际usage后才可用gate.settle(callId,usage)对账rejected；不能仅凭HTTP码自动结算0。对账为0的单测使用合成声明，不是供应商费用结论。超用仍先完整记录再锁定。当前账本仅单进程内存，API还需持久化及跨实例总预算。

开启恢复不会改变profile.limits.maxCalls/maxTotalTokens/maxCostMicros。以评分1＋知识2为基线，评分修复或网络重试都需要额外调用空间；每次实际派发仍受原额度约束。验收计划输出recovery策略及总HTTP/费用上限，不承诺所有允许的恢复都一定有足够预算。

## 模型结构修复

明确finish_reason=length且完整usage时，可将输出额度提升到原profile.maxOutputTokens并重新生成，或continue追加纯文本后缀；最多一次，不延长原deadline。首段空或含工具片段拒绝续写，续写禁用工具；后缀原样拼接，不去重/补括号。最终仍完整schema/引用/算分，再截断或非法JSON不算成功。

开启输出恢复时先缓冲供应商SSE、完整计量，再交SDK，避免替换已发布片段；默认关闭时保留原流式路径。原始usage独立记账，最终SDK消息用量不替代HTTP账本。

auto_compact/reactive_compact见[上下文](memory-context.md)。只裁已知规划的可选memory；必填内容不可压缩则停止。仅HTTP400/413且error.code精确匹配context_length_exceeded/context_window_exceeded/input_length_exceeded时允许一次reactive，明确拒绝仍记rejected保留费用。不靠错误正文关键词猜测。

首次输出先走既有可选本地json-fence-only解包；仍然JSON/schema错误时才考虑模型修复。新建独立无工具Pi会话，使用原评分投影（原题、回答、量规）及固定错误类别，重新生成完整对象；不把坏输出、动态Zod路径、上游错误或私密诊断塞给模型。

修复结果仍通过原schema、引用唯一性/偏移与确定性算分。结构恢复不证明评分正确或教学效果。修复再次非法则保留失败，不循环生成；历史画像和能力观测只在全部验证成功后产生一次候选。API正式提交仍需归属、lease/fence与CAS检查。

## 诊断与演练

live manager增加recoveryDiagnostics()，每run最多64条固定枚举并返回深拷贝；记录阶段、动作、原因、尝试数及等待毫秒，不含文本、HTTP头或凭证。仅运行中接纳事件，迟到不修改终态；观察器抛错不改变业务结果，观察器触发取消仍撤销成功资格。HTTP recovered只在完整合法usage结算后记录；evaluation recovered仅表示生成输出的结构检查通过，后续宿主评分仍可能拒绝。

验收报告新增plan.recovery与recoveryDiagnostics，旧报告不补造恢复原因。失败恢复不修改公开HTTP/SSE契约。

运行bun run agent:model:recovery:demo，使用真实Pi SDK、注入HTTP响应和合成usage，让Java/Web两岗各经历429→坏JSON→修复→知识工具循环，输出到.cache/model-recovery-demo/report.json。共10次注入HTTP尝试，8次结算1040个合成token，2次rejected继续预留；真实模型调用0。它验证本地工程机制，不证明真实供应商限流恢复、网络质量、真实费用或评分语义质量。

## 运行状态与持久写入的恢复决策

HTTP重试/输出修复表描述调用层，下面的动作还受任务终态、依赖是否真实结束和owner租约共同约束。`retryable`不是新run授权，不自动重启整个任务。

| 条件 | 结果/事件 | 账务与槽位 | 后续动作 |
| --- | --- | --- | --- |
| 取消/期限到达，依赖仍未结束 | 保持cancelled/failed，拒绝迟到成功 | 槽位保留到实际依赖结束，消耗不补0 | 不自动新run |
| completed/failed/cancelled，owner租约仍有效 | SQLite checkpointRun拒绝终态后任何新事件/状态（DURABLE_TERMINAL） | checkpointBudget仍可按原版本/身份结清已派发usage | 同run结果只重放；账务与结果分开 |
| 租约恰好到期，reserved未派发 | interrupted，旧owner结果/预算写入均DURABLE_FENCED | reserved释放，不作为已收费请求 | 新run由宿主决定，旧任务不复活 |
| 租约到期，dispatched未结 | interrupted，旧owner双通道拒写 | 转unknown并保持预留、阻断派发 | 显式可信对账后才可新run |

SQLite终态防护位于checkpointRun事务中，先核对owner/fence/lease，再拒绝非running行或已有终态快照；拒绝不会插入事件或改变结果。它补足内存层的迟到结果过滤，不冻结消耗台账，也不删除/重写历史记录。旧owner不能用已过期租约“补账”，应走受控对账。API正式事务、权限和CAS仍独立负责。

`bun run agent:recovery:boundaries`生成同一决策表对应的可执行验收报告：双岗14场景、取消/超时实际异步依赖、真实SQLite的取消/超时/完成终态、精确租约边界、reserved/unknown及两类迟到写入。检查运行时行为，不把决策表当模型可修改配置。使用注入评估/usage和租约时钟，无真实模型、网络分区或供应商账单验收；结果写入新的.cache/recovery-boundary-acceptance/run-*，摘要不是签名。

专项：`bun test tests/recovery-boundaries.test.ts tests/durable-store.test.ts tests/durable-runtime.test.ts`。默认HTTP尝试次数、生产期限和模型预算不放宽。

终态发布顺序同时受保护：业务里程碑发布时快照仍running，最后run.completed才封存结果。专项补充 `bun test tests/durable-terminal-publication.test.ts tests/checkpoint-publication.test.ts tests/workflow-http.test.ts tests/workflow-rsi-http.test.ts`，防止加强存储防护后遗漏最终完成事件。
