# 错误、取消与恢复契约 v1

语音宿主函数沿用本目录错误码：WAV/确认格式错误为VALIDATION_ERROR，音频大小或时长超限为CONTEXT_BUDGET_EXCEEDED，ASR输出/时间段不合法为MODEL_OUTPUT_INVALID，供应商异常为DEPENDENCY_UNAVAILABLE。未新增HTTP语音路径，详情见 [语音契约](speech.md)。

学习/复测：跨用户FORBIDDEN、跨岗位宿主归属ROLE_FORBIDDEN、任务/事件版本或同ID改内容VERSION_CONFLICT；损坏事件/报告、未来时间、非法证据引用等VALIDATION_ERROR。合法但学习未核实、条件不符或缺参考返回ineligible及原因；聚合样本不足insufficient_data且MAE=null，不当作运行异常或0误差。

离线实验：experimentId不符FORBIDDEN，岗位不符ROLE_FORBIDDEN；新操作版本/当前基线/策略ID定义/回退祖先不符或同operationId变更业务内容VERSION_CONFLICT。时钟倒退、伪造summary、审计结构或容量非法VALIDATION_ERROR。合法评测失败记录rejected而非抛依赖异常。旧操作相同重放不重新启用候选，不越过offline-experiment作用域；正式事务由API负责。

反思/策略：基线ID与报告版本不符为VERSION_CONFLICT，岗位不符ROLE_FORBIDDEN，未pin/篡改规划/非法候选参数/开发验证来源重叠为VALIDATION_ERROR。合法评测样本不足、未改善或退化返回rejected及reasons，不冒充运行异常。失败不自动发布或修改基线，缺后续表现时校准保持等待。

记忆：跨用户FORBIDDEN、跨岗位ROLE_FORBIDDEN；重复会话内容变化或新追加版本落后VERSION_CONFLICT；损坏JSON/schema/未来历史/时钟倒退/容量超限VALIDATION_ERROR。旧会话相同内容重试先按该会话acceptedAt与幂等处理，不因后续updatedAt变化而失败。任何失败均不改输入快照；没有自动截断、归属兜底或覆盖新版本。

资源目录非法（含畸形URL/非allowlist/重复ID）统一VALIDATION_ERROR，不泄漏URL解析异常。查询错误按取消、期限、岗位和预算分类；合法无命中为empty，不冒充依赖故障。报告增强遇到工具错误或取消/过期拒绝整个增强结果，不更改原报告；缺匹配资源只保留gap警告。

内容报告错误：schema/缺记录/重复ID/评分重算不符/引用或轨迹错配/时钟倒退返回VALIDATION_ERROR；轮次跨岗位或跨宿主用户返回ROLE_FORBIDDEN。失败不返回部分报告，不自动补分或跳过非法轮次。仅本地计算，无模型依赖重试；报告HTTP鉴权与正式提交尚未实现。

单轮编排：宿主参数非法为 VALIDATION_ERROR；端口返回结构、证据、必填或完整性不合格为 MODEL_OUTPUT_INVALID；端口抛出的内部异常统一 DEPENDENCY_UNAVAILABLE，不泄漏原文。超时/期限为 DEADLINE_EXCEEDED，用户取消为 RUN_CANCELLED。任何错误均不返回状态候选，不自动重试。后台供应商取消效果、API 最终提交撤销与重试幂等仍需独立实现验证。

Pi评估器的已分类AgentStateError会由编排层保留；未知异常才归一为DEPENDENCY_UNAVAILABLE。最终stopReason=error也映射为依赖不可用，不混淆为内容结构错误。工具尝试、非stop完成、无效JSON、额外字段和超出输出预算为MODEL_OUTPUT_INVALID；输入提示超限为CONTEXT_BUDGET_EXCEEDED。SDK错误原文/原始事件不透传。选题缺口是unavailable状态，不伪装成功或供应商异常。

HTTP 错误使用 application/problem+json：type（稳定 URN）、title、status、code、detail（可公开摘要）、requestId、retryable。不返回 stack、供应商原文、key、SQL 或内部路径。所有集合接口未来使用 cursor/limit，默认 20、最大 100。

| code | HTTP | 可重试 | 行为 |
| --- | --- | --- | --- |
| VALIDATION_ERROR | 422 | 否 | 指出输入不合法；不回显敏感字段 |
| CONTEXT_BUDGET_EXCEEDED | 413 | 否 | 必要状态或完整评分回答超出字符预算；不得静默截断评分 |
| UNAUTHENTICATED | 401 | 否 | 要求重新登录；不后台循环刷新失败凭证 |
| ROLE_FORBIDDEN / FORBIDDEN | 403 | 否 | 停止该访问，禁止跨岗/跨用户兜底 |
| NOT_FOUND | 404 | 否 | 资源不存在或不可见 |
| VERSION_CONFLICT | 409 | 否 | 获取正式状态，由用户/应用决定后续 |
| RUN_CANCELLED | 409 | 否 | 已撤销提交资格，不接受迟到结果 |
| TOOL_BUDGET_EXCEEDED | 429 | 否 | 本次运行预算耗尽，不换工具绕过 |
| RATE_LIMITED | 429 | 是 | Retry-After；统一调度器在总预算内处理 |
| DEPENDENCY_UNAVAILABLE | 503 | 是 | 只读依赖有限重试、退避，记录 attempt |
| DEADLINE_EXCEEDED | 504 | 否 | 当前 run 期限耗尽，终止继续调用 |
| MODEL_OUTPUT_INVALID | 502 | 是 | 默认拒绝；已支持显式本地JSON围栏解包，模型修复调度尚未实现；未来重试须计入总预算 |
| NOT_IMPLEMENTED | 501 | 否 | 骨架能力尚未实现，不返回虚构业务数据 |
| INTERNAL_ERROR | 500 | 否 | 公开通用摘要，带 requestId，服务端记录脱敏诊断 |

工具回执与 HTTP 使用同一 code catalog，但工具返回结构化 status/error，不把 HTTP code 当成模型可随意恢复的授权。query empty 是正常 empty，不使用异常触发全网搜索。

## 统一预算与结果资格

自然提问呈现是可选附加步骤：未花费的额度/时间不足或已完整结算的非法桥句可回原题，原因明确写入delivery；评分失败、取消、期限、依赖失败以及unknown/overrun不会因此变成功。它不增加模型自动重试，详见[呈现契约](question-delivery.md)。

Pi SDK retry/compaction 首版关闭。业务 run 最多两次任务尝试，每次最多三次 LLM 请求（含输出修复）、五次工具、120 秒；语音服务另设有界任务预算。只能由任务执行器统一重试，SDK/HTTP client/工具不得叠加无界重试。

HTTP 超时不保证远端没执行。API 用 run/attempt/sessionVersion/租约控制正式提交；无法确认外部副作用的未来写工具返回 unknown 并人工/业务核对，不自动重做。已实现种子工具只读，未实现数据库事务不得声称业务恰好一次。

取消先记录业务取消并撤销 attempt 提交资格，然后传递 AbortSignal 并 await Pi abort。agent_settled 只是 SDK 停止自动继续，不等于输出有效；成功需最终 schema、证据、权限与提交资格均通过。客户端退出/断流不取消任务；重连读正式快照，持久事件按序号补齐，临时 delta 可丢失。

## 骨架行为

发题确认API helper使用独立静态PRESENTATION_*错误码，见[确认契约](question-ack.md)。这些错误目前不新增HTTP映射或成功路由；精确重放回执不重新激活题目，取消/过期不能转换成展示成功。

当前 /health 返回 stage=scaffold、能力列表和 liveModelConfigured=false。/v1 或 /internal/v1 下未实现能力统一 501；未知路径 404。没有登录/模型/数据库时绝不返回“面试完成”。error→HTTP 公开映射使用固定说明，不信任任意 Error.message。

## 内部离线运行

宿主可选的HTTP重试和模型结构修复见[恢复契约](model-recovery.md)。默认关闭；明确429/503拒绝可有界等待重试，unknown/取消/过期/鉴权失败不自动恢复。引用与评分错误不能补造成成功，不重跑整个业务任务。

显式启用turn.clarification时，完整结构且逐项显式null的证据不足是正常needs_clarification/abstained结果，run可completed但未评分、不提交观测。它与有证据的0分、漏字段/非法引用的MODEL_OUTPUT_INVALID及取消/超时错误不同；默认严格turn/完整workflow仍保留原校验。补充绑定/策略冲突为VERSION_CONFLICT，结构非法为VALIDATION_ERROR。详见[澄清与弃评](agent-runtime.md#显式澄清与弃评)。

内部 HTTP 使用同一错误目录；运行期间的错误写入失败快照和 run.failed。取消与超时均拒绝迟到结果，SSE 断开只退订。429 表示内存记录或活跃上限，不承诺排队；409 包括同 runId 变更内容/attempt、旧 attempt 取消及超前游标。重启丢失内存任务和幂等记录，不能依此恢复正式提交。详见 [内部运行契约](agent-runtime.md)。


评分证据静态诊断增加no-substantive-answer/risk-only-verification/advice-only-ownership。前者可在合法宿主校验后以0次模型请求澄清/弃评；后两者只识别已声明维度的有限反例。需要严格完整评分的路径拒绝不安全结果；支持弃评的路径返回null，不将其作为技术错误0分写入。详见content-rubrics.md，不将负向规则称通用语义验证。

## 宿主门控与请求内分支

Pi三个适配器共用CompletionGate；工具错误/未结束工具/异常停止/宿主输出校验失败不能返回有效结果。可选同步验证钩子异常按拒绝处理，观测回调仍不改变业务。评分JSON/schema修复从请求内Pi树checkpoint分支，旧错误仍保留但不进入新模型上下文；树不是持久业务回滚，重启与unknown恢复仍由持久账本决定。压缩器只可删选已知规划memory子序列，不改变当前题答、量规、系统或工具对。详见[Agent Harness](agent-harness.md)。
