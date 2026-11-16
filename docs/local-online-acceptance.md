# 本地在线验收与故障演练

2026-11-15。复用[本地运行时](local-runtime-api.md)和[语音宿主](client-speech-runtime.md)，不改桌面或默认联网行为。批次冻结、执行门控、恢复观察和五故障演练已实现；首次本地真实文字批次在Java评分拒绝后停止，不能宣称双岗通过。后续真实供应商执行仍需新批次授权。

## 批次与授权

prepare只构建生产sidecar并冻结源清单、产物SHA256、双岗输入/来源、模型/语音配置和额度，生成可审阅材料；不检查凭证、不联网。源、产物、配置或音频变化均需新批次。

text批次默认使用明确标注的AI合成development文本，双岗各最多3次模型HTTP，总6次、人民币2元声明费率预算。不是学生真实答案，也没有人工评分参考。speech批次需显式提供两份规范WAV和确认文本/来源声明；最多10 HTTP、3元声明预算，其中模型2元，ASR/TTS各0.5元，均非厂商实付保证。

execute必须显式--execute及匹配batchId/digest、供应商/端点/模型、凭证来源声明、额度和期限的授权文件。CLI不自动加载.env；只在全部验证通过、获得一次性execution claim且子进程发起私有请求时，读取已批准的项目专用环境变量。不会继承Key给sidecar。无授权、旧批次、输入变更、过期授权、测试产物或路径异常均不得触碰凭证/派发。

同一批次只执行一次。失败和中断保留claim、profile及报告，不延长期限、刷新额度或自动追加调用。recover仅在原profile的批次owner标记、既有schema/控制身份/manifest和完整性校验通过后，无凭证打开原profile，恢复/查看任务、会话与账目并写独立恢复证据；空/损坏/残缺profile不会被初始化。源码变化会标sourceCurrent=false；原WAV被清理也不妨碍恢复观察，冻结产物变化仍拒绝；此宽限不适用于execute。unknown继续阻断付费。原失败报告不改成成功。

## 离线演练

演练使用明确隔离的injected-test-only产物，禁用真实fetch，凭证是合成字符串。正常链路与缺凭证、ASR429、超时、取消迟到、dispatch标记后进程退出分别记录实际任务/预算/HTTP次数与预期断言。

派发标记后退出只证明持久恢复，不证明真实供应商已收到请求。429不证明免费；responded/rejected仍保守保留费用占用。取消不保证远端停止；超时/unknown不能自动退款或重发。

离线演练、真实供应商接线、真人识别/评分、硬件、凭证库和供应商账单是不同证据。所有合成报告固定humanReferenceCount=0、qualityClaimEligible=false，不据此声称教学或RSI改善。离线demo/drills不读取真实Key、不发付费调用；execute须独立授权。


## 命令与文件

在仓库根目录执行；外层也指定--no-env-file，避免包管理器提前自动加载项目.env：

```powershell
bun --no-env-file run agent:local:online prepare
bun --no-env-file run agent:local:online demo
bun --no-env-file run agent:local:online drills
bun --no-env-file run agent:local:online inspect <batch目录>
bun --no-env-file run agent:local:online recover <batch目录>
```

prepare生成生产Bun sidecar、batch.json、review.md和禁用的authorization.template.json（operatorApproved=false、expiresAt=0），默认6请求/2元声明上限；不读取Key或访问供应商。demo构建单独test-only产物，用真实Pi/stdio完成双岗10次合成HTTP及零调用恢复。drills独立运行五故障，保存每例观察/预算/检查和合成HTTP计数；报告列出实际所选场景和逐项结果；CLI固定运行完整五类，重复/非法场景会拒绝。

语音批次采用显式文件输入：

```powershell
bun --no-env-file run agent:local:online prepare --speech-inputs C:/InterviewInputs/samples.json
```

samples.json为两个元素的数组，每项roleId为java-backend或web-frontend、origin为user-provided或synthetic-development，answerText为将确认的原文（1—10000字符），audioPath指向规范16kHz/单声道/PCM16 WAV。相对音频路径按samples.json所在目录解析。冻结复制品是实际发送内容；改原文件不会改变已冻结副本，需要新prepare。来源只是操作者声明，不自动变成真人/专家核验。

只有在用户明确审阅供应商/模型/端点、凭证来源和额度后，才将禁用模板复制为同批次目录的authorization.json并填写明确批准和未来到期时间，然后：

```powershell
bun --no-env-file run agent:local:online execute <batch目录> --authorization <batch目录>/authorization.json --execute
```

凭证来自主进程resolver或已准备好的项目专用进程环境；CLI只按冻结引用读取INTERVIEW_QIANWEN_API_KEY/INTERVIEW_BAILIAN_ASR_API_KEY，不直接读.env或个人/全局凭证。变量缺失导致本批失败，不能靠重放execution重获额度。LLM/ASR/TTS分别绑定私有grant/ref，子进程环境仍不继承Key。

执行在取Key/spawn前验证完整批次和授权，再以wx独占execution.json；profile目录必须全新并写批次owner。正常读取/execute严格绑定当前源码、固定配置、输入副本与产物hash。失败保留report.json及profile，重复execute不新派发。recover不延长授权、不解除unknown，不覆盖report.json，只写recovery-UUID.json；它是观察结果，不是新的在线通过证明。

共享schema见[local-acceptance-schemas.json](local-acceptance-schemas.json)。执行摘要只存操作ID、任务/预算和计数，不把原文、原音频或凭证打到console；私有batch.json/WAV/profile仍含敏感输入，应按用户数据管理，且不提交Git。SHA256检查一致性，不声称可抵抗恶意本地操作者替换整套文件。

## 评分拒绝定位与离线回归

每个已结束job的报告条目包含`diagnostics`和`diagnosticCapture`。执行器在检查job成功/失败前按afterSeq分页读取事件，最多16页、每页100条及64条固定分类诊断；验证job身份、递增seq与共享schema。`recorded`表示读取到诊断，`none`表示事件中无诊断，`unavailable`表示读取或校验失败；后两者都不能被解释为模型输出合法。诊断不改变评分标准，也不触发模型重试。

具体拒绝需查看`outcome=rejected`的诊断：`jsonIssue/jsonShape`区分JSON边界，`schemaIssue`定位固定字段和接收类型，`quoteIssue/bindingIssue`定位引文或验证绑定。transport记录的是完成边界事实，不能单独当作拒绝根因。既有批次没有保存这些数据时，恢复不能重建已丢失的模型输出；应保留原失败，使用新冻结产物、新授权采集。

离线回归`tests/local-evaluation-diagnostics.test.ts`通过真实Pi和本地SQLite分别注入非法JSON、score类型错误、不存在的引文及无目标却带绑定四类输出，核对拒绝、零正式提交、消耗持久化、重启诊断与改正输出后的通过；这些是合成协议样例，不是对历史真实输出的重放。`tests/local-acceptance-diagnostics.test.ts`检查分页、身份和脱敏边界，验收执行器测试检查真实stdio报告接线。

带诊断的真实批次已捕获`scoring / score-binding-invalid / unexpected-binding`：模型为没有verificationGoal的评分项输出了绑定；该次传输、JSON、通用schema及引文定位均通过。旧批次没有诊断，不能据此追认旧失败也是同一原因。修复在生成契约侧：`promptForRubric`按当前宿主量规生成JSON Schema，无目标的整套量规从允许字段中移除verificationBinding；混合量规逐项禁止或要求绑定，并固定goalId/version、maxScore和弃评分支。schema仅作为模型指引，不宣称供应商强制执行；宿主量规/引用/绑定校验保持不变，违规对象仍拒绝，不能剥除绑定来伪装通过。新量规约束的真实效果需新批次复测。
