# 模型配置、预算与百炼／千问接入

原offline-fixture和live-planned预检保留；新增独立live-service执行入口，默认关闭。live-planned仍不可执行，声明预检始终不授予网络权限。本轮只用注入HTTP响应验证真实Pi SDK和预算，没有读取真实密钥、探测供应商或发出在线模型请求；原离线runtime不自动切换。

## 入口与配置

```powershell
bun run model:preflight
bun run model:preflight --planned
bun run agent:model:budget:demo
```

默认预检退出0；--planned会输出LIVE_TRANSPORT_DISABLED并退出1，这是预期阻断，不是联网失败。参数/配置错误退出2。预算demo纯本地回调，两岗各3次合成调用，真实模型调用0；本demo没有使用Pi SDK计量token，既有pi:offline是另一项SDK集成验证。

配置位于apps/agent/src/model-access：offline.profile.json为本地演示，live-planned.example.json为不可执行的占位声明。共享Schema见packages/contracts/src/model-access.ts与[机器契约](model-access-schemas.json)。预检只返回固定诊断，不回显原始输入/endpoint/凭证内容。

| 声明 | 含义 |
| --- | --- |
| providerId / modelId / apiFamily | 宿主明确选择的模型标识；live-planned仍为unselected；live-service由宿主固定百炼模型 |
| credentialSource | 离线必须none；在线保存env-reference-only名称，不接受key值；预检不读值，live入口授权后惰性解析 |
| limits | 次数、并发、单次计划输入/输出token、总token、成本、UTF-16输入/输出字符和超时 |
| pricing | id/version、离线USD或live百炼CNY、每百万输入/输出token的整数micro单位；来源为synthetic或host-declared-unverified |
| scope | 由宿主固定budgetId/userId/roleId/runId/attemptId/deadlineAt，调用封装要求精确一致 |

在线URL要求HTTPS且无userinfo/query/fragment；这只是配置约束，不验证服务安全或网络可用。原live-planned的INTERVIEW_MODEL_API_KEY只是名称引用，预检不解析.env、不查询process.env、不扫描个人/global Pi配置；独立live入口只解析宿主明确配置的变量。配置合法不等于凭证可用、价格准确、预算充足、身份认证或用户已授权付费。

预检中的canExecuteFixture表示离线执行模式，实际仍须reserve；canExecuteLive仍恒false，因为配置声明本身不提供授权。预检networkAccess=disabled只描述不执行网络的预检器，不描述独立live服务的实际传输，也不是OS沙箱；受信注入回调没有被隔离运行。

## 百炼live-service入口

用户选定阿里云百炼。`AGENT_MODE=live-service`要求显式服务token和`AGENT_LIVE_CONFIG_PATH`，后者读取宿主JSON（256KiB上限、严格UTF-8、拒绝符号链接/非文件）。配置样例`apps/agent/src/model-access/bailian.example.json`的enabled/operatorApproved均false、expiresAt=0，不能直接启动在线服务。需在获得真实试跑授权后，由部署方设置授权期限、maxRuns、同地域endpoint/模型、指定凭证变量名与预算；不在仓库填写key。

唯一环境凭证读取位于启动入口注入的`readCredential(name)`，仅访问配置的`INTERVIEW_*`名称，且每次调用先验授权/期限/服务账本。没有.env解析、个人订阅或全局Pi凭证发现。工厂构造和health均不读取key；health的liveModelConfigured只表示已配置接口，不证明凭证/网络/模型可用。AGENT_PLANNING_MODE仍只控制离线入口，live规划模式来自受控JSON的planning。

启动接线（仅在单独完成模型/凭证来源/预算授权后使用）：

```powershell
$env:AGENT_MODE='live-service'
$env:AGENT_LIVE_CONFIG_PATH='C:\server-config\interview-bailian.json'
# AGENT_INTERNAL_TOKEN及INTERVIEW_BAILIAN_API_KEY由服务配置/密钥管理注入，勿发给客户端。
bun run dev:agent
```

配置接受百炼官方兼容域名（含四个已列地域的workspace专属域名），以及经官方文档核对的千问平台精确域名maas.qianwenaiapi.com；固定/compatible-mode/v1路径。providerId=qianwen与该千问域名绑定，bailian不能混标；实际请求必须精确指向/chat/completions，POST且redirect:error。模型无法传URL/key/预算。Pi公开api/openai-completions负责协议与工具消息，空CredentialStore/无模型目录刷新，所有请求使用宿主明确key。SDK客户端和外层provider重试均设0；会话retry/compaction继续关闭，prefetch不执行。real-provider SSE不直接透给客户端，产品SSE仍只发阶段/题目/终态。

每个可信run通过forRun绑定同一预算，评分和可选pi-knowledge规划的多次HTTP发送共用账本；每次实际transport调用前reserve/dispatch，不能一份预留无限重试。示例最多2个进程内run、每run最多3次HTTP；每次预留配置的输入/输出token上限，max_tokens硬传供应商、enable_thinking=false。初始prompt字符限制不等于精确输入token限制；没有tokenizer预计数，实际usage超过预留会完整记账、拒绝业务成功并锁定。工具调用也逐次记账。

流末从原始SSE独立核验prompt_tokens/completion_tokens/total_tokens及[DONE]，不把SDK默认0当完整usage；缓存token属于prompt子集，思考token属于completion子集，不重复相加。解析器支持分片UTF-8/CRLF，未完成event缓冲有限制、单响应至多2MiB；缺失/不完整/冲突usage、中断/异常都保留unknown。完整usage先结算，即便模型JSON非法也计费；迟到usage不自动退款。HTTP错误、取消或超用不会自动重试。

live费率与ledger.currency为CNY，micro为百万分之一元；按全部输入/输出token与宿主声明费率估算，缓存折扣、阶梯/活动优惠与供应商账单未核实。SDK内cost=0仅禁用其默认美元估算，不能当免费，预算真值在gate。示例费率按官方页面的未优惠标价保守配置，启用前必须核对地域/固定模型版本与现行计费。不是厂商扣费硬上限。

任何unknown或overrun会阻止本进程后续新run/HTTP，已派发调用仍可能消耗费用；诊断modelAccounting只返回账本，不暴露key/回答。它不是持久钱包：重启会丢账本与保护状态，禁止用重启/重建实例掩盖欠对账。正式跨进程预算、供应商账单核对、身份/租约/CAS仍需API接管。注入transport是受信代码，不是网络沙箱。

本轮验证：实际Pi评分→规划工具查询→候选选择在注入的OpenAI兼容SSE上运行，3次HTTP尝试共用一个账本；没有供应商在线成功或真实费用证据。其他回归覆盖默认关闭/过期、端点/凭证、取消、usage缺失、超用锁定、坏JSON仍计费、health语义。原model:preflight和budget:demo继续离线。

## 千问平台与小样本验收

2026-11-04用户指定千问AI平台端点，而非原百炼DashScope入口。[千问官方快速入门](https://platform.qianwenai.com/docs/developer-guides/getting-started/introduction)和[Qwen Code鉴权文档](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)列出https://maas.qianwenaiapi.com/compatible-mode/v1。仅放行这个精确host，不放开任意URL、同后缀子域或重定向；providerId=qianwen区分平台。原百炼配置保持兼容，不能据共享兼容协议推断两平台key、地域或账单互通。该URL本身未编码“华东”地域，本轮不额外推断地域映射。

默认关闭的qianwen.example.json使用qwen3.8-max（可变别名，不声称固定快照）、INTERVIEW_QIANWEN_API_KEY、pi-knowledge、两个run每个最多3HTTP，声明预算每run1元/合计2元。按[千问价格页](https://platform.qianwenai.com/docs/developer-guides/getting-started/model-prices)2026-11-04列出的12/36元每百万输入/输出token声明费率估算，不含缓存优惠，不是认证账单或厂商硬扣费上限；启用前应核对控制台。原Plus样例是另一个配置，不能把它的费率应用给Max。

bun run agent:model:acceptance默认只输出计划，既不读取key也不创建模型请求，即使环境已有key也不会联网。需要执行时必须同时传--execute --config <宿主JSON路径>，严格授权开关、期限、工具规划、两run/三次预留条件检查通过后才创建运行时。样例enabled/operatorApproved=false，不能直接执行。用户指定凭证可放项目根.env的INTERVIEW_QIANWEN_API_KEY空位，文件被Git忽略；Bun启动时可加载.env到进程环境，应用不自行扫描其他配置或个人密钥。不要将真实key写入.example、报告或聊天。

验收固定Java后端/Web前端各一条手写合成回答及草案题库，复用正式runtime完成结构化评分→真实知识工具→候选选题。顺序执行，任一失败/unknown或超用停止后续样本。每次transport均走既有gate；收到完整usage但模型JSON无效仍计费。取消保留已经发生的尝试，0次HTTP不会写成供应商成功。

执行前在.cache/live-bailian-acceptance/run-*保存prepared-not-completed的plan.json，结束保存report.json与review.md；正常失败也保留候选/账本/静态原因，进程崩溃只有准备记录时不能声称已完成或持久恢复。报告含实际模型配置摘要、合成输入/摘要、候选、工具回执、各run延迟及用量/预留，控制台只输出概要；不落原始SDK事件、上游错误正文或密钥。HTTP只由真实默认transport执行时标live-http，注入transport测试标injected-http，不把它叫供应商在线验证。

passed-mechanics只表示两岗的结构/引用校验、知识工具和候选选题通过。humanReview始终pending，semanticQuality/referenceScores=null；人工需逐条审核答案正确性、分数合理性和资源关联。naturalFollowupVerified/vendorBillingVerified始终false：当前仍返回题库题，不自动证明自然追问、情绪/压力或教学效果。没有金标准不能算评分质量提升。

专项测试使用真实Pi SDK+假凭证+注入SSE，覆盖两岗6HTTP/780合成报告token、默认不执行、授权/额度不足、首岗HTTP失败unknown后停止、预取消、精确域名与平台绑定。2026-11-04用户本地填写凭证并明确授权后完成首次真实试跑：qwen3.8-max返回完整usage（输入724、输出372），但Java首样本结果契约校验失败，代码MODEL_OUTPUT_INVALID，整体failed；仅1次HTTP，Web样本和知识规划未执行，不自动重试。完整用量已结算，宿主声明费率估算0.02208元、unknown预留0，不是供应商认证账单。报告没有原始模型正文，无法据统一错误码确定非法字段或引用根因；结构化输出、语义评分和完整双岗在线验收仍未通过。

项目根.env已预留INTERVIEW_QIANWEN_API_KEY，其余本地API/Agent地址端口、独立服务token、模型配置路径、桌面API地址与Compose数据库默认值可由开发环境补齐；真实值不进入.example或Git。默认AGENT_MODE仍scaffold，填key不触发在线模型调用；单次试跑结束后临时授权JSON恢复关闭。数据库连接/正式业务并未因存在DATABASE_URL而完成，ASR/TTS现已在独立pilot入口接通千问平台适配，使用项目专用语音Key；显式启用、额度和未验证质量见[pilot运行](pilot.md)。

## 输出诊断与受控格式修复

共享契约EvaluationDiagnosticSchema只含version、stage、outcome、reason固定枚举，不携带模型正文、Zod动态路径/错误、引用文本或凭证。Pi阶段区分finalization（截断/工具/大小/供应商失败）、json解析、schema结构；turn编排另区分evidence原文/UTF-16偏移与scoring算分/完整性。公开错误仍使用原MODEL_OUTPUT_INVALID等目录，不向客户端广播这些内部诊断。诊断回调异常不会改变评分结果。

live运行时为每个可信run保留最多16条诊断，evaluationDiagnostics()返回复制快照；验收报告落同名字段，计划记录outputRepair。取消、终态或期限后不接纳迟到诊断。该快照仅进程内，不是持久事件/原始流回放；本轮宿主evidence/scoring诊断只覆盖turn路径，完整workflow仍仅收集Pi层阶段，不声称已覆盖所有分支。

outputRepair默认none，保留严格行为。宿主可显式选择json-fence-only：只对整个输出唯一外层的完整小写json代码围栏做一次确定性解包，内部必须是可严格解析的JSON对象；随后仍执行原EvaluationOutput schema、原文偏移、引用与量规算分。含前后解释、截断JSON、缺字段、越界分数、伪造引用都拒绝；不提取任意片段，不补分、不重定位证据、不改答案。repaired事件只表示格式处理，不保证后续校验成功。此处理没有额外模型请求；统一有预算的模型修复/退避重试调度尚未实现，不能将本地解包视为该能力交付。

历史首次真实失败报告没有原始输出或阶段诊断，具体根因仍未知；本轮离线案例不能证明上次失败由代码围栏导致。接线和修复仅用真实Pi fixture/注入HTTP验证，不重跑真实模型、不覆盖原失败报告；后续诊断试跑仍须遵守已授权的累计次数/预算，不能重新初始化账本隐藏之前1次尝试。

## 宿主引用定位与真实小样本边界

evidenceGrounding默认model-offsets，继续严格验证模型提供的数字。宿主可显式设unique-excerpt：模型仍须输出完整原schema，程序只在逐字摘录于当前完整回答中唯一出现时生成UTF-16 [start,end)。不修剪或改写摘录，不模糊匹配，不补字段/改分数/改ID；缺失、重复ID或重叠重复匹配均拒绝。随后仍通过原ScoringContextSchema和确定性算分。位置改变时记录unique-excerpt-grounded，验收计划保存模式；这个诊断不表示语义评分可信。该模式下重复短句即使模型位置正确也保守拒绝，需要更长的唯一摘录。

证据诊断现在细分ID重复、偏移越界、摘录不存在、唯一摘录偏移不匹配与重复摘录歧义。2026-11-04两次新增strict真实Java定点调用先后定位invalid-evidence和evidence-offset-mismatch；后一条表明当次至少一条唯一逐字摘录的索引错误，不能倒推未留阶段诊断的最早失败。显式宿主定位后的Java定点调用通过，未新增模型修复请求。

其后首轮双岗验收在Java完成评分/工具调用，但回执empty、selection=unavailable，整体未过smoke；这与运行失败或评分失败不同。工具query实际是字面子串过滤而非语义检索；原查询参数未留存，不能完全还原空结果。补清首查按skillId/limit、omit query及字面过滤契约后，最后一轮两岗均通过评分→真实知识工具→岗位候选：Java选java-technical-visibility，Web选web-technical-closure。仅代表两个草案合成回答的工程链路通过，人工参考和评分质量审核仍pending，没有真实学生教学效果或自然追问证据。

最后一轮实际6HTTP、6109token，宿主声明费率估算0.089388元；本轮所有诊断/失败/成功合计12HTTP、11972token、0.190200元，达到12次调用上限后停止。含更早首次失败累计13HTTP、0.212280元声明估算成本，未核对供应商账单。失败报告和原始用量保留，不用成功样本替换；默认样例仍关闭授权、model-offsets、不自动启用宿主定位。后续批次继续显式管理预算，不把调试脚本的本地记录称为生产全局钱包。

## 供应商选择依据（2026-11-04核对）

推荐百炼为首个适配，DeepSeek官方作为后续独立对照。百炼提供[OpenAI兼容接口](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)、[工具调用](https://help.aliyun.com/zh/model-studio/qwen-function-calling)及独立[ASR服务](https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide)，方便本项目逐步接通文字/语音；ASR不能直接假设复用文本OpenAI协议。Key与endpoint须同地域，官方推荐workspace专属域名，旧域名仍兼容。

先用非思考Plus档跑工程与自有评分样本，配置样例固定qwen3.7-plus-2026-05-26；示例模型在[官方价格页](https://help.aliyun.com/zh/model-studio/model-pricing)列出，不代表账户已开通或质量验证。是否换Max/其他版本依据样本准确性、延迟与实际usage，不凭模型名字下结论。DeepSeek官方也提供[工具调用](https://api-docs.deepseek.com/guides/tool_calls/)与[按token计费的模型接口](https://api-docs.deepseek.com/quick_start/pricing/)，可作为对照；本轮未实现DeepSeek适配或自动fallback。

## 预算账本

createModelBudgetGate拥有单实例、单scope内存Map，无数据库、磁盘恢复、跨进程或用户总钱包配额。创建另一个实例会有另一份额度，业务API以后必须管理唯一账本生命周期、持久化/租约/CAS，不能把本地scope比较当认证。

| 操作/状态 | 额度语义 |
| --- | --- |
| reserve → reserved | 同步原子检查并预留计划token/成本与并发槽，callsConsumed加1；任何重复callId均拒绝 |
| dispatch → dispatched | 只能从reserved进入，重新检查截止/锁；无自动重试 |
| release → released | 仅未dispatch可释放token/成本/并发；次数仍不退还 |
| markUnknown → unknown | 已派发失败、取消、超时或无完整用量，继续保留全部预留及并发 |
| settle → settled | 仅dispatched/unknown接收宿主完整用量；释放预留、计入实际声明用量/估算成本；相同用量重试幂等，修改冲突 |

unknown不等于免费，也不一定全局锁：maxConcurrent>1且仍有token/成本时，其他调用可使用剩余槽位。仅已观察用量超过预留时sticky锁住本实例的新reserve/dispatch；已派发调用仍可对账，即使超过deadline。超用完整记录，不裁剪到预算上限。

用量必须complete=true，inputTokens/outputTokens非负整数；reportedCostMicros可选。未确认完整用量时不能结算0来解除占用。模型输出文本本身不被当作可信usage；本地回调用量由宿主传入，百炼live适配已从原始SSE核验完整usage；本轮注入数据验证不证明供应商实际协议/计费一致。

settle成本取“声明费率×报告token的估算”和reportedCostMicros较大者；后者也只是宿主报告，不是经过认证的账单。超过预留的任一输入、输出或成本都算overrun，即使总预算尚有余量。锁不会自动解除；业务方需要调查和新预算授权，不靠重建实例隐藏超用。

## 费用与token口径

离线整数micro-USD表示百万分之一美元；live百炼micro-CNY表示百万分之一元，账本currency必须同时读取。算法为ceil((inputTokens×inputRate+outputTokens×outputRate)/1,000,000)，BigInt先相乘求和再统一向上取整，避免浮点低估这份声明公式。演示费率完全合成，不是当前任何供应商报价。

planned token数由宿主声明，不是分词器测得，也不能从字符数推导硬保证。封装把maxInputTokens/maxOutputTokens/timeoutMs传给回调，但不能阻止受信回调忽略它们；字符上限独立检查。供应商的缓存、推理、额外工具收费、计费取整和隐藏重试均未计量，**本地估算上限不是供应商扣费硬上限**。未来在线接入须核对完整计费规则、真实用量、重试及厂商侧限额。

原runBudgetedFixtureCall的maxCalls计接受的逻辑预留，不能计量受信回调内部自发的多次请求；它不自动重试。新增百炼适配在每次HTTP发送前重新reserve/dispatch，SDK与会话重试关闭；不能复用一份预留无限重试。

## 执行与错误

可选SQLite账本checkpoint与中断对账已实现，见[持久任务](durable-runtime.md)；原内存模式仍保留。profile费率仍是声明值，实际费用与跨机全局配额尚未核验。上下文错误拒绝、length追加请求均纳入同一账本。

共享provider新增显式开启的有界HTTP恢复和独立评分结构修复，详见[统一错误恢复](model-recovery.md)。rejected保留最坏预算、释放逻辑并发槽；unknown继续阻止派发。SDK自动重试仍关闭，host的每次重试和修复均计入原run额度，不自动增加预算。

封装先检查scope、离线模式、预取消、输入字符与预算，再派发回调。用Promise race和单调时钟共同检查期限；晚返回成功不会覆盖取消/超时，unknown保留到显式对账。同步CPU不能被强行中断，远端计算是否停止也未验证。

及时收到合法完整usage时先结算，再检查文本；坏答案或过长输出并非免费。如果usage超用，完整记账后拒绝返回业务成功并锁住后续工作。没有合法usage、依赖抛错或已超时无法接纳响应时保留unknown；迟到usage不自动退款，只有宿主明确调用settle对账。

所有依赖拒绝重新转换为静态MODEL_DEPENDENCY_FAILED，即使依赖伪装成ModelAccessError或改写message；宿主产生的取消/截止等错误也按受信枚举重建。时钟故障/回退拒绝为MODEL_CLOCK_INVALID。错误代码属于本地模块，未新增HTTP状态或正式提交事件。

## 原离线预算验证与后续验收

宿主可显式设置questionDelivery=natural-bridge，默认为canonical。完整双岗验收相应要求每岗4次预留（评分1+知识2+呈现1），总token至少4倍单次预留；报告计划记录模式，回退原题不能通过“已生成”验收。2026-11-04该模式真实小样本8HTTP/7007token/0.103236元声明估算通过，人工语义审核仍pending；本轮在完成目标后关闭临时授权，没有用满12次/5元调试上限。含此前调试累计21HTTP、0.315516元声明估算，未核对账单。配置/绑定/隐私和当前未覆盖范围见[自然提问呈现](question-delivery.md)。

测试覆盖声明脱敏、在线禁用、整数取整、原子预留、并发与总额度、scope/拷贝隔离、重复调用、未知保留、迟到结算、超用锁定、取消/截止、被改写错误及双岗demo。演示最终每岗3次本地回调，225个合成报告token、250 micro-USD声明估算、locked=true；没有真实费用或模型质量结论。

后续在线试跑必须先获得明确的供应商、模型、凭证来源和预算授权；受控网络适配、内部服务鉴权、原始用量解析与零重试已接线，仍需供应商在线兼容验证、实际usage/费用核对、跨进程预算持久化与对账。当前schema或JSON声明不能代替这些授权，现有正式业务API仍按[接口文档](api.md)的实现边界执行。

完整workflow的每个命令独立使用受控run账本：有前答的plan为知识2次＋呈现1次，answer评分1次；首题plan无桥句，create/finish/restore为0次。2026-11-04两岗各两题真实会话共14HTTP、12935token、0.188436元声明估算，unknown与剩余预留为0，完成后关闭本轮16HTTP/5元临时授权。连同此前21HTTP/0.315516元，累计35HTTP/0.503952元声明估算；非供应商账单。JSON写盘读回与文本绑定通过，不代表正式存储、学生展示确认、评分语义或教学效果已验证。
