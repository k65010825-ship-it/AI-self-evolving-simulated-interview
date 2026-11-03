# 模型配置预检与离线预算闸门

本模块准备模型接入前的配置和预算边界，**不包含在线传输**。默认offline-fixture；live-planned即使字段完整也始终不可执行。没有读取/创建模型凭证、探测DNS/HTTP、配置供应商或发出真实模型请求；现有Pi离线runtime不自动切换到新模块。

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
| providerId / modelId / apiFamily | 宿主明确选择的模型标识；本轮在线例子均unselected，没有供应商适配 |
| credentialSource | 离线必须none；在线计划仅env-reference-only名称，不接受key值，不检查变量存在或可用 |
| limits | 次数、并发、单次计划输入/输出token、总token、成本、UTF-16输入/输出字符和超时 |
| pricing | id/version、USD、每百万输入/输出token的整数micro-USD；来源为synthetic或host-declared-unverified |
| scope | 由宿主固定budgetId/userId/roleId/runId/attemptId/deadlineAt，调用封装要求精确一致 |

在线URL要求HTTPS且无userinfo/query/fragment；这只是配置约束，不验证服务安全或网络可用。INTERVIEW_MODEL_API_KEY只是名称引用，本模块不解析.env、不查询process.env、不扫描个人/global Pi配置。配置合法不等于凭证可用、价格准确、预算充足、身份认证或用户已授权付费。

canExecuteFixture表示本模块支持离线执行模式，实际每次仍须通过reserve；canExecuteLive永远false。networkAccess=disabled表示模块未安装在线调度器，不是操作系统网络沙箱；受信宿主提供的回调代码本身并未被隔离运行。不得借回调绕开当前离线授权。

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

用量必须complete=true，inputTokens/outputTokens非负整数；reportedCostMicros可选。未确认完整用量时不能结算0来解除占用。模型输出文本本身不被当作可信usage；本地回调用量由宿主传入，未来在线适配需从供应商协议中解析并核验，当前无此能力。

settle成本取“声明费率×报告token的估算”和reportedCostMicros较大者；后者也只是宿主报告，不是经过认证的账单。超过预留的任一输入、输出或成本都算overrun，即使总预算尚有余量。锁不会自动解除；业务方需要调查和新预算授权，不靠重建实例隐藏超用。

## 费用与token口径

整数micro-USD表示百万分之一美元。算法为ceil((inputTokens×inputRate+outputTokens×outputRate)/1,000,000)，BigInt先相乘求和再统一向上取整，避免浮点低估这份声明公式。演示费率完全合成，不是当前任何供应商报价。

planned token数由宿主声明，不是分词器测得，也不能从字符数推导硬保证。封装把maxInputTokens/maxOutputTokens/timeoutMs传给回调，但不能阻止受信回调忽略它们；字符上限独立检查。供应商的缓存、推理、额外工具收费、计费取整和隐藏重试均未计量，**本地估算上限不是供应商扣费硬上限**。未来在线接入须核对完整计费规则、真实用量、重试及厂商侧限额。

本地maxCalls计接受的逻辑预留，不计回调内部自行产生的多个网络请求。runBudgetedFixtureCall自身不自动重试，也不声称已控制某个尚未接入SDK的内部重试。所有实际网络尝试必须在后续适配中显式纳入预算，不能复用同一预留无限重试。

## 执行与错误

封装先检查scope、离线模式、预取消、输入字符与预算，再派发回调。用Promise race和单调时钟共同检查期限；晚返回成功不会覆盖取消/超时，unknown保留到显式对账。同步CPU不能被强行中断，远端计算是否停止也未验证。

及时收到合法完整usage时先结算，再检查文本；坏答案或过长输出并非免费。如果usage超用，完整记账后拒绝返回业务成功并锁住后续工作。没有合法usage、依赖抛错或已超时无法接纳响应时保留unknown；迟到usage不自动退款，只有宿主明确调用settle对账。

所有依赖拒绝重新转换为静态MODEL_DEPENDENCY_FAILED，即使依赖伪装成ModelAccessError或改写message；宿主产生的取消/截止等错误也按受信枚举重建。时钟故障/回退拒绝为MODEL_CLOCK_INVALID。错误代码属于本地模块，未新增HTTP状态或正式提交事件。

## 本轮验证与后续接入

测试覆盖声明脱敏、在线禁用、整数取整、原子预留、并发与总额度、scope/拷贝隔离、重复调用、未知保留、迟到结算、超用锁定、取消/截止、被改写错误及双岗demo。演示最终每岗3次本地回调，225个合成报告token、250 micro-USD声明估算、locked=true；没有真实费用或模型质量结论。

后续在线试跑必须先获得明确的供应商、模型、凭证来源和预算授权；还需实现受控网络适配、服务鉴权、厂商用量解析/重试控制、跨进程预算持久化与对账。当前schema或JSON声明不能代替这些授权，现有正式业务API仍按[接口文档](api.md)的实现边界执行。
