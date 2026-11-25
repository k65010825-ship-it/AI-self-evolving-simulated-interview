# 本地客户端接入契约

面向 Electron 主进程和本地业务接线。实现与源 schema 位于 feature/agent；本文保留跨团队接入要求，不展开 Pi、存储算法、压缩或内部评测实现。机器定义：[RPC schema](local-runtime-schemas.json)、[语音 schema](local-speech-schemas.json)。

## 1. 启动与权限边界

使用 `@interview/local-agent-client` 的 `spawnLocalAgent({executable,entry,dataDir,assetsRoot,cwd})`。主进程传包内 bun.exe、runtime.js、独立用户目录及只读安装资源目录；使用绝对路径、无 shell、隐藏窗口。目录不能互相包含；路径由主进程配置，renderer/RPC 不得自行改变。不启动 localhost HTTP。

`client.request(method,params)` 返回响应；`client.subscribe(fn)` 接收公开事件；`client.waitForJob(jobId)` 查询终态；`client.close()` 请求排空，超时仅终止自己创建的子进程。preload 只暴露具体业务方法，不暴露通用 request、spawn、SQL、文件路径或私有凭证帧。

先调用 runtime.initialize，再调用业务方法。SDK 不继承个人 Key、全局 Pi 配置或 .env。未配置凭证时可以离线开发，但 offline-fixture 结果不得标作真实模型成绩。

## 2. 帧、任务与状态

新建本地会话固定实际使用的draft-preview开发目录快照（seed＋expansion中已配置技能的条目）、目录id/摘要及其精确historyCompatibility，保存在已有workflow JSON中；旧会话缺少pin时保留seed及原策略，不补写或清空历史，无数据库版本升级、新表或新RPC。priorEvidenceCount仍为保留的原始历史总量，不代表全部参与能力估计；不兼容记录仍保留并用于避免重复考题。目录摘要与精确版本匹配只是宿主完整性/兼容声明，不代表内容已经人工审核、不同量规具有测量等价性或来源模式已经获真人认证。reviewed-only目录为空时明确缺题，不降级到草案。

新建会话固定local-v4规划策略（`maxTurns=8`，旧已提交会话保持 `maxTurns=6`），支持 `practiceMode`（`weakness-focus` 弱点优先 | `broad-coverage` 未覆盖技能优先），保留 `difficultyProgression` 并显式启用 `catalog-unseen-v1` 回退；原计划技能耗尽时按策略优先级换到有合格未见题的技能，只有整个固定目录没有合格未见题才因 `knowledge_gap` 收尾。查询先排除已见题并按目标难度排序，再取Top-K。旧会话没有回退标记时保持原行为。profile版本仍为v3，既有workflow JSON保存目录及有效发题计划，不新增DDL或新表，桌面不传这些内部参数。页面使用已提交问题和状态；时长仍是预算，不承诺每次升难都能选到精确难度的题目。

本地外挂内容包校验由 `apps/agent/src/knowledge/verify-content-pack.ts`（契约 `packages/contracts/src/content-pack.ts`）负责：验证清单 schema、运行时版本兼容性、无符号链接路径安全、逐文件 SHA-256 与字节长度、workspace/curation/六技能目录一致性，以及 `reviewSummary` 真实匹配与 `productionPublished` 未过审拦截；任一步失败均返回结构化失败码并保留内置兜底目录与进行中会话已固定的 `catalogPin`。

UTF-8 JSONL，protocolVersion=1；stdout 仅协议，原始 stderr 不直接显示给学生。单帧≤1MiB，回答≤10000 字符，最多 8 个在途请求。

澄清补答沿用session.answer：text必须保留clarification.previousText的完整原文前缀，并在末尾追加非空补充；使用当前revision和新的operationId。宿主从该题已提交回执沿用观测ID，回答/运行ID仍为新值，客户端不传这些内部ID。相同operationId同内容可并发或跨重启重放，异内容拒绝；ACK丢失先查询/重放，不新建另一份补答。弃评仍为null，不是0分；结束时未评分题只进入报告缺口，不增加能力观测或成长记忆。语音确认也走同一宿主提交路径，不另发session.answer。

```json
{"protocolVersion":1,"type":"request","id":"req-1","method":"session.get","params":{"sessionId":"session-id"}}
```

公开事件包在 `{protocolVersion:1,type:"event",event:{jobId,seq,status,stage}}` 中。任务受理返回 jobId，queued/running/candidate-ready 不是正式提交；completed 后读 session.get 确认结果。job.events 按 afterSeq 补读持久事件，每次最多 100 条；不承诺通知恰好一次。

写命令用 operationId 幂等，重放同内容返回原 job；同 ID 异内容 VERSION_CONFLICT。request.id 只关联响应。session.get 的 revision 和 lastOperation 用于旧版本拒绝及 ACK 丢失后的恢复；不要超时就换 operationId 再提交。

## 3. 文字面试与只读查询

| 方法 | 参数 / 结果 |
| --- | --- |
| runtime.initialize/status/shutdown | 初始化能力、运行状态、受控关闭；初始化不读取 Key |
| roles.list | 返回双岗六大主技术/项目技能＋独立 `collaboration` 维度目录（`RoleListSchema`），诚实标注 `draftCount`/`reviewedCount` |
| session.create | operationId、roleId、goal、durationMinutes（15—25）、practiceMode?（`weakness-focus`/`broad-coverage`）、pressure?、mode?、liveConfig?、sessionBudget?、speech? → jobId/sessionId |
| session.list | offset? / limit?（1—100）→ viewKind=summary 的会话数组；详情字段为空，hasReport/needsClarification与计数保留 |
| session.get | sessionId → viewKind=full、presentationVersion=1、startedAt/deadlineAt、revision/phase、当前题、澄清/逐轮反馈与计数、默认首屏report、lastOperation、mode、authorizationStatus |
| session.answers | sessionId、offset?、limit?（1—5，默认5）、expectedRevision? → 版本固定的逐题作答页，含评分/澄清/弃评 |
| session.report | 同上 → 已完成报告页；未收尾返回null，未知会话仍报错 |
| session.nextQuestion | sessionId、operationId、expectedRevision → jobId/sessionId |
| session.answer | 同上＋text；身份/当前题由宿主绑定 |
| session.complete | 同 nextQuestion；正常收尾并保存报告/记忆 |
| profile.get / practice.recommendations / reflection.list | 基于本机已提交会话与记忆只读投影（能力、`local-progress-views-v1`）；不修改状态、不发起模型调用 |
| hint.status / hint.request | 当前题提示计数与一级/二级引导（见第 8 节，接入 HintRepository 后启用 `limited-hints-v1`） |
| learning.status / assignment.create / event.record / retest.plan / retest.pair | 本地学习复测写协调器与 XP 查询（接入 LearningRepository 后启用 `local-learning-v1`；`verifyPractice` 仅限宿主内部受信任路径） |
| experiment.status / evaluate / rollback | 离线策略实验读写与回滚（接入 ExperimentRepository 后启用 `local-experiments-v1`；始终 `not_published`） |
| memory.get | roleId → 本机本岗有界记忆；不要直接把内部结构当最终画像页面 |
| job.get/cancel | jobId → 任务视图；取消不表示供应商退款 |
| job.events | jobId、afterSeq? → 有序公开事件 |

初始化能力除 `session-presentation-v1` 外，已提供 `local-progress-views-v1`；默认随包运行时现已接入 `@interview/local-db` 的 `profile v4` 迁移与正式 SQLite repository，`runtime.initialize` 默认启用 `limited-hints-v1`、`local-learning-v1` 与 `local-experiments-v1`（当显式禁用对应存储依赖时仍诚实返回 `*_STORAGE_UNAVAILABLE`）。会话视图已提供clarification（中性prompt与原回答previousText）、lastAnswer、submittedCount/scoredCount/unscoredCount及needsClarification；同题多次澄清只算一题，answeredCount仍沿用已评分题数。三种答案状态为scored/needs_clarification/abstained；数值0与null分开，不把任务失败当技术零分。新增能力见[接口导航](api.md)。提示每题最多2次有效提示、不扣金币，详情见第 8 节；同岗位只允许一场未完成、未过期会话；不同岗位可以并行。

主进程 SDK 已提供 `listRoles()`、`createSession()`、`getProfile()`、`getPracticeRecommendations()`、`listReflections()`，以及 `getLearningStatus()`、`createLearningAssignment()`、`recordLearningEvent()`、`planLearningRetest()`、`pairLearningRetestSession()`、`getExperimentStatus()`、`evaluateExperiment()`、`rollbackExperiment()`（均校验返回 schema；`verifyPractice` 不暴露给公开 renderer stdio）。

### 3.1 SDK读取、分页与安全展示

主进程SDK新增getSession(sessionId)、listSessions(options?)、getAnswerPage(sessionId,options?)和getReport(sessionId,options?)，严格校验返回schema，畸形响应只报LOCAL_RESPONSE_INVALID，不抛原始内容。旧request方法继续保留，但preload只暴露具体业务调用。

session.get的report是默认5条的已评分答案首屏，不是全量报告。按answerPage.nextOffset继续调用session.report；session.answers按发题顺序返回已提交作答，合并同题澄清过程，nextOffset为null才表示读完。跨页携带首屏revision，状态变化返回VERSION_CONFLICT，应重新查询并重新分页，不能拼接不同revision。报告仅逐题评分，aggregation=per-answer-only，带sessionId/revision/generatedAt/policyVersion与逐题rubricVersion/scope，不跨量规伪造统一总分。

证据仅包含当前原回答中被评分引用的片段，UTF-16 start/end与answerId绑定，每题最多3条、每条240字符，truncated和evidenceOmitted明确展示裁剪。坐标可定位不等于语义正确，semanticSupport仍not_verified。只显示既有反馈发布门控允许的内容；withheldFeedbackCount提示有条目暂缓，空数组不代表没有问题。criteria.label是固定展示名，不透出评分锚点/正确答案/量规全文、内部工具回执或模型推理。criterion action保留null，学习建议从报告studyPlan读取。

列表只用于导航，不能把report=null解读为没有报告，使用hasReport再读取详情。读取不创建任务、写表或发起供应商调用，旧profile保持v3。以上为feature/agent的接入能力，桌面/真人质量仍需独立验收。

## 4. 真实模型与凭证接线

主进程提供 `resolveCredential({grantId,credentialRef,requestId,signal})`，从自己的凭证库按授权读取。SDK 协商 credential-broker-v1，秘密仅走独立私有帧，不进入公开事件、preload、日志或本机数据库。系统凭证库实现与桌面接线由前端负责，不能把 Key 写进安装包。

1. session.create 设置 mode=live，提交不含 Key 的 liveConfig 和固定 sessionBudget，planning 为 pi-knowledge。先创建会话，不立即发模型调用。
2. live.authorize 提交 grantId、sessionId、expectedVersion、expiresAt、credentialRef、profile。续授权不增加总额度。live.revoke 按 sessionId/expectedVersion 撤销；live.budget 查询额度/使用/授权版本，不包含秘密。
3. nextQuestion/answer 按已授权模式执行；不因授权失败回退 fixture。重启需新 grantId 续授权，不自动取 Key 或重发未完成调用。
4. live.reconcile 为受信主进程的有据对账操作，参数含 session/job/run/attempt/callId、expectedVersion、usage 和 evidenceRef；不暴露给 renderer。unknown 消耗未处理前阻断新派发，费用估算不是厂商账单。

完整配置字段以共享 schema 和 feature/agent 源 contracts 为准，不能从本文简表自行拼接供应商配置。

## 5. 语音接入

录音由前端转为单声道、16kHz、PCM16 WAV，完整文件≤4MiB、≤120秒；上传固定 byteLength/sha256，每块最多32KiB原始字节，规范 base64。不能提交任意路径、URL 或供应商参数。只在创建会话时通过 speech 配置启用语音；旧会话不追加能力。

| 方法 | 输入 / 行为 |
| --- | --- |
| speech.upload.begin | operationId、sessionId、expectedRevision、byteLength、sha256 → audioId/块信息 |
| speech.upload.chunk | audioId、index、base64；顺序传输，改内容或跳号拒绝 |
| speech.upload.finish | audioId；验证音频，不自动触发收费 ASR |
| speech.asr.start | operationId、audioId、expectedRevision → jobId |
| speech.task.get | jobId → 转写/版本/任务状态 |
| speech.confirm | operationId、jobId、expectedVersion、expectedRevision、text → 正式评分 jobId；不是只保存一份编辑文 |
| speech.answer.retry | 新 operationId、原失败/中断评分 jobId、expectedRevision；显式重试原确认答案，不重复 ASR |
| speech.tts.start | operationId、sessionId、expectedRevision → jobId；只播当前已发题，不能传任意 text |
| speech.audio.read | jobId、offset → base64/nextOffset/eof/mimeType/sampleRate；按返回格式播放，输出为24kHz WAV |
| speech.audio.release | audioId 或 TTS jobId；释放缓冲，不删除任务/预算回执 |
| speech.authorize/revoke/budget/reconcile | 显式区分 asr/tts 的授权、查询、撤销与有据对账；schema 定义具体字段 |

LLM/ASR/TTS 使用各自 grantId/credentialRef 和子额度，共受会话总额约束。转写先给用户确认，旧题目、旧 revision、取消或收尾后的语音不得提交。语音确认后不要再另发一次 session.answer。

原录音/TTS字节只在有界内存；重启不能续传旧录音或保证旧 TTS 可播放，过期返回 AUDIO_EXPIRED，不自动重录/合成收费。TTS/ASR 完成不代表已播放/已答题或表达可靠性已验证。

## 6. 客户端必须处理的失败

启动初始化失败会释放本次已取得的profile资源和租约，保留原始错误与预算记录；这不表示会自动修复损坏数据，也不能释放其他owner/fence的占用。持久候选恢复仍须通过原期限、版本、grant和预算校验；失败任务保持interrupted，errorCode可保留COMMIT_LEASE_EXPIRED、COMMIT_VERSION_CONFLICT等格式受限原因，未识别异常仍为INTERRUPTED。页面先查询原操作，不按错误自动重发收费命令。

live.reconcile的预算写入与唯一对账回执在同一事务：任一步失败都回滚，unknown及占用继续保留；成功后同内容可跨重启重放，异内容拒绝，不重复计费。对账不重开终态任务、不自动提交旧模型候选或增加额度；authority仍为宿主提供usage，不能标作供应商账单已核验。

| 情况 | 接线行为 |
| --- | --- |
| VERSION_CONFLICT | 重新查询正式 revision/原操作，不能覆盖或重复奖励 |
| ROLE_SESSION_ACTIVE | 展示/继续已有本岗会话，不反复创建 |
| PROFILE_BUSY / PROFILE_FENCED | 拒绝双宿主写同一 profile，不删用户库或靠 PID 强解锁 |
| 授权失效 / 额度耗尽 / BUDGET_RECONCILIATION_REQUIRED | 展示原因，受信主进程续授权或对账；不重置消耗 |
| interrupted / 管道断开 / 通知丢失 | 重启后查询任务/会话并补读事件；不自动重新执行收费动作 |
| AUDIO_EXPIRED / 旧录音不可恢复 | 明确需要新的录音或播报操作，不显示假音频 |

错误公开响应只含 code；诊断不代替评分说明。退出不自动删数据，换号不静默接管旧 profile。账号/profile 隔离、硬件、系统凭证库、非开发机安装和真实质量仍需独立验收，见[产品验收计划](evaluation-plan.md)。

## 7. 学习、复测与策略接线要求

复测要排除原记录中答过但未评分/弃评的题，不能因没有分数就当作新题。冻结记录保存完整历史/本场已评分及报告内未评分题ID，最多4400条，不截断；仅展示未作答的题仍须由宿主完整已发题清单排除。已有冻结记录不自动补写，缺来源信息的旧记录不能因此追认为独立复测证据。点击或自报完成不等于核验完成，模拟配对不能混入真人校准。

RSI首版只允许声明的单步追问深度调整，其余策略参数必须完全不变；评估、激活候选和实验快照恢复使用相同约束。正式策略发布/客户端采用仍未验收，离线实验结果不可冒充已上线或真实教学改善。Agent 侧现已提供 `learning.*` 与 `experiment.*` 协调器、stdio RPC 与测试 fixture；默认随包尚未注入数据库负责人正式 `LearningRepository` / `ExperimentRepository`（契约见[数据库交接 §8.5](database.md#85-学习复测与离线实验-repository-契约)），未注入时明确返回 unavailable，不能用模拟成功代替正式持久化交付。

## 8. 每题限次提示与辅助作答

学生端通过 `hint.status {sessionId}` 获取当前已发题的 `issueId/used/remaining/reserved`；`hint.request {operationId,sessionId,issueId,expectedRevision}` 返回固定版本的一级/二级引导、原操作回执及当时剩余次数。每题最多2次成功提交，不扣金币、不调用模型；提示按technical/project/scenario/behavioral提供拆题及边界/取舍引导，不承诺提示内容已经人工质量审核。没有当前题、缺旧题内容或过期请求须明确拒绝。

提示计次按profile/session/稳定发题绑定，不能用workflow revision作计数键：澄清会改revision但不换题。成功提示原子保存回执及宿主持有的辅助标记，并递增workflow revision/storage version；客户端提示后刷新session再提交答案。旧operationId重放返回原回执（即使已用两次、换题、收尾、重启），不重新生成、不退次，响应中的remaining是该次提交时的值，当前值以status为准。并发预占返回HINT_BUSY，释放/中断操作需新operationId；已提交ID不得复用为面试或语音操作。

| 场景 | 对外行为 |
| --- | --- |
| 未接入持久repository | status `available=false/reason=HINT_STORAGE_UNAVAILABLE`；request同码拒绝，不用内存次数替代 |
| 两次已提交 | HINT_LIMIT_REACHED；原成功operationId仍可重放 |
| 旧revision/旧issue | VERSION_CONFLICT/HINT_ISSUE_MISMATCH，不消耗成功次数 |
| 回执写入失败/启动时仅有预占 | 事务回滚/释放预占，保留已提交次数；不自动重试模型 |
| 本地提示历史与宿主标记不一致 | HINT_BINDING_MISMATCH，禁止以新空journal清零 |
| 模型预算unknown | 新提示请求阻断；原提示回执可只读重放，不结算或清除unknown |

回答的 `assistance={kind:'hint-assisted',issueId,hintVersion,receiptIds}` 只能由宿主从持久回执注入，文字与确认语音走相同提交协调器；renderer不传自报“未辅助”。提示后的澄清可增加辅助回执，不能删除/替换已有回执。逐题反馈保留练习分和辅助标签，能力画像、跨会话独立能力证据、难度递进、复测校准及RSI候选依据排除辅助回答；报告不把辅助分声称为独立成绩。旧数据缺标记保持旧语义，不追认为已经验证独立性。

`feature/agent`已提供核心状态机、宿主/RPC和repository注入接线；默认随包入口尚未接入正式repository，不宣称提示产品可用。数据库负责人按[数据库交接](database.md#84-限次提示-repository-契约)实现同profile连接上的持久化与迁移，联合验收后启用 `limited-hints-v1` 能力。桌面UI、真实用户体验和非开发机安装另行验收。

## 9. 本地子进程故障诊断与恢复

主进程SDK支持 `client.diagnostics()` 读取最近64个受限诊断事件，也可给 `spawnLocalAgent` 传 `onDiagnostic(event)`。传输故障的 `LocalAgentClientError` 保持原code/message，附加 `diagnostic={schemaVersion,lastClient,lastRuntime,discarded}`；不存在可用阶段时对应字段null，不猜测原因。诊断只含枚举阶段/原因、RPC方法、相对耗时、退出码与信号，不含答案、路径、凭证、模型输出或原始stderr。它用于主进程排障，不能直接转发任意依赖日志给renderer。

| 故障 | 宿主接入方处理 |
| --- | --- |
| PROCESS_EXIT已记录，stdout尚未关闭 | SDK停止接新请求，但继续读取尾部合法响应；等close确认通道收尾，不把exit直接当响应丢失 |
| LOCAL_REQUEST_TIMEOUT | SDK拒绝该连接的全部等待请求、撤销凭证代理并终止自有子进程；不自动重试或补发收费动作 |
| LOCAL_PROTOCOL_INVALID | 包括半截JSON/UTF-8尾部和非法帧；连接失效，不把残缺响应当成功 |
| STARTUP_FAILED＋LOCAL_PATH_INVALID等受限原因 | 检查数据/安装目录与运行环境，保留路径安全限制；不能通过清库、换profile或取消校验来“恢复” |
| LOCAL_SHUTDOWN_INCOMPLETE | 并发close调用共享同一有界结果；保留失败，不假称子进程和占用已释放 |

公开stdio协议版本与业务错误响应不变。诊断stderr为私有旁路，只接收完整白名单帧；其余文本丢弃、超长行丢弃，回调抛错不影响通信，无自动落盘/上传。启动阶段缺失或退出信号只能缩小范围，不能单凭重跑通过宣布偶发故障根除。

主进程须保留原业务operationId。进程死亡/超时后，使用原profile重新启动并查询既有任务/回执；已提交结果重放、未完成任务按原恢复规则，已派发无usage继续unknown。超时不等于模型未调用，不新建operationId绕过幂等或费用；数据库迁移与真实用户恢复仍按各自验收要求执行。
