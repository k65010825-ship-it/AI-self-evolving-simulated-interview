# 本地 Agent：启动与stdio协议

本地宿主支持默认offline-fixture与显式live文字会话，模式在创建时固定。独立子进程＋stdio RPC；会话、记忆、任务、事件、预算和回执保存于用户目录SQLite。不启动本地HTTP端口，不依赖试点账号或远程业务API。live复用Pi与供应商适配，当前仅以合成凭证、注入HTTP离线验证；本地语音任务/转写确认/TTS分块已接入，同样仅离线注入验证；系统凭证库、硬件和桌面接线尚未验收。

第二阶段实现见[本地真实模型与凭证代理](client-live-runtime.md)；最新v3在备份v1/v2后加入语音同库状态；总额度固定在session，grant更新不重置用量，unknown仍阻断。

公共schema来自`packages/contracts/src/local-runtime.ts`，机器可读版本见[local-runtime-schemas.json](local-runtime-schemas.json)，随`openapi:generate`生成；stdio不伪装为OpenAPI的HTTP路径。

## 启动与打包

```powershell
bun run agent:local --data-dir C:/InterviewUserData --assets-root C:/InterviewResources
bun run agent:local:build
bun run agent:local:acceptance
bun run agent:local:live:acceptance
bun run agent:local:speech:acceptance
```

首条命令读取stdin JSONL，不是交互式聊天。两个路径必须绝对、互不包含，资源目录须存在，用户数据目录可由宿主创建。检查所有现存祖先与profile内部junction，**建目录前**拒绝链接逃逸。默认用户目录为`<dataDir>/agent/profiles/default`，不默认写仓库或安装资源。主进程应传自己的userData；RPC不能改变路径。

build生成新的`.cache/local-agent-build/本地 agent-*/`，包含固定Windows x64 Bun、已bundle的runtime.js和assets/manifest.json。知识seed和提示随JS一起打包并保留原版本/草案标记；不复制.env、账号或用户数据库。acceptance实际启动此产物，用另一中文空格cwd和独立用户目录跑双岗面试及重启记忆。它不是Electron安装包验收。live:acceptance额外构建隔离的injected-test-only产物，禁用真实网络，通过合成resolver和HTTP验证真实Pi＋私有管道；该测试产物不能分发给用户。

## 主进程接入

使用`@interview/local-agent-client`的`spawnLocalAgent({executable,entry,dataDir,assetsRoot,cwd})`。`executable`为包内bun.exe，entry为runtime.js。SDK采用绝对路径、无shell、隐藏窗口和私有stdio；不继承供应商Key/HOME/.env，不自动联网。初始化和业务方法都必须显式调用。

`client.request(method,params)`返回业务结果；`client.subscribe(fn)`接收公开事件；`client.waitForJob(jobId)`轮询终态；`client.close()`请求排空，超时仅终止自己创建的子进程并等待退出。事件处理器不决定业务结果。桌面preload只暴露所需业务方法，不向渲染进程暴露spawn、文件路径或任意request方法。

## 帧与方法

UTF-8 JSONL，protocolVersion固定1。stdout仅协议，stderr有界消费但不向界面转发原始依赖内容。单帧1MiB；答文字1万字符；服务端写回队列2MiB，有2秒写超时；客户端最多8个在途请求。业务任务同时执行2个，总待处理不超过8个。

```json
{"protocolVersion":1,"type":"request","id":"r1","method":"runtime.initialize","params":{}}
{"protocolVersion":1,"type":"response","id":"r1","ok":true,"result":{"protocolVersion":1,"mode":"local-runtime","storage":"local-sqlite","capabilities":["text-interview","persistent-memory","persistent-jobs","event-replay","credential-broker-v1"],"liveModelCalls":0}}
```

| 方法 | params/结果 |
| --- | --- |
| runtime.initialize | `{capabilities?:["credential-broker-v1"]}` → 就绪能力；不读取供应商凭证 |
| runtime.status | `{}` → 模式、activeJobs/queuedJobs、executionStarts、unknownAttempts |
| runtime.shutdown | `{}` → 关闭准入、取消/排空、关闭SQLite，成功后stopped=true |
| roles.list | `{}` → 双岗标识及名称 |
| session.create | `{operationId,roleId,goal,durationMinutes,pressure?,mode?,liveConfig?,sessionBudget?,speech?}` → `{jobId,sessionId}`；时长15—25分钟 |
| session.list | `{offset?,limit?}` → 会话数组；offset默认0，limit默认100，上限100 |
| session.get | `{sessionId}` → LocalSessionViewSchema：revision、当前题、逐题报告、lastOperation等 |
| session.nextQuestion | `{sessionId,operationId,expectedRevision}` → jobId/sessionId |
| session.answer | 同上＋text；宿主决定身份/原答/题目/任务快照 |
| session.complete | 同上；显式user_stop收尾，事务保存报告/记忆/回执 |
| live.authorize | `{grantId,sessionId,expectedVersion,expiresAt,credentialRef,profile}` → 新grant；须先协商凭证能力 |
| live.revoke | `{sessionId,expectedVersion}` → `{version}`；停止派发并取消该会话任务 |
| live.budget | `{sessionId}` → `{budget,totals,grant,version}`；不含秘密 |
| live.reconcile | `{sessionId,jobId,runId,attemptId,callId,expectedVersion,usage,evidenceRef}` → 对账回执；仅受信主进程 |
| memory.get | `{roleId}` → 本人本岗有界记忆，最多20场（现有核心约束） |
| job.get / job.cancel | `{jobId}` → LocalJobViewSchema；取消不等于外部请求免费 |
| job.events | `{jobId,afterSeq?}` → 最多100条有序本地公开事件 |

写命令受理不等于完成。operationId按规范化后的方法/内容持久幂等；同内容重放返回原job，异内容VERSION_CONFLICT。request.id仅关联一次响应。同岗位仅允许一场未完成、未过期会话，防止固定baseMemory在并行收尾时冲突；不同岗位可以并行。失败或取消的创建不占用一场正式会话。

通知形如`{protocolVersion:1,type:"event",event:{jobId,seq,status,stage,diagnostic?}}`。candidate-ready是候选持久化，**completed才表示本地宿主已事务提交**。事件先落库再通知，断线/通知丢失后按afterSeq补读；不保证通知恰好一次。session视图的lastOperation使ACK丢失后仍可发现任务。

`diagnostic`是可选的`EvaluationDiagnosticSchema`，只在running且stage与诊断stage一致的事件出现。内容仅含固定分类：transport/finalization/json/schema/evidence/scoring、结果与原因枚举、字段类别及类型等；不含模型原文、回答片段、错误消息、密钥或路径。它复用现有local_events表，SQLite仍为v3，旧事件没有该字段仍可回放。评分诊断在任务终止前由宿主同步写入；失败/取消不清除已写诊断，终止后的迟到结果不得追加。前端按任务状态渲染，诊断只供主进程排障，不代替完成回执或评分解释。

本地真实模型验收曾出现规划成功、评分`MODEL_OUTPUT_INVALID`；旧产物未保存字段级诊断，无法从该通用码倒推出具体原因。新产物可通过job.events分页读取诊断并随验收报告保存。该机制的离线分支验证不等于真实评分已修复或质量已验收。

## 存储、恢复和故障

`profile.sqlite`使用单连接/WAL/FULL；租约、正式workflow/memory、任务/事件、预算与回执同库。每次写事务检查owner/fence与期限，提交前复查，禁止跨await事务。默认租约30秒、每10秒续租；第二实例PROFILE_BUSY，失效实例PROFILE_FENCED，不靠PID删锁。

重启只提交已有合法、未过期的持久候选，其他未完成任务记interrupted，不重建模型executor。终态与操作回执原样可查。已有dispatched预算转unknown并保留预留，reserved转released；unknown阻止新命令派发。本地offline不会产生收费记录，不能因此宣称生产预算/账单验收。

空库初始化schema v3；v1/v2在持有租约后通过同连接serialize生成一致性备份，独立校验并写manifest，再事务新增live/语音表。备份/DDL失败保留原版本并拒绝启动；不自动覆盖回滚用户主库。高版本拒绝，旧服务数据库不自动导入。备份包含用户回答，应随profile保护。

## live接入顺序与私有凭证帧

主进程创建SDK时提供`resolveCredential({grantId,credentialRef,requestId,signal})`。SDK在initialize时自动协商credential-broker-v1。该回调由主进程读取系统凭证库，Agent包不提供桌面凭证库实现。没有resolver仍可离线使用，未协商时live.authorize拒绝。

1. session.create设mode=live，提供LiveServiceConfig（不含Key，planning须为pi-knowledge）与固定sessionBudget；无模型创建完成后revision=0、authorizationStatus=required。
2. live.authorize绑定已存在session、固定profile与截止时间，expectedVersion初始为0；grant仅续期、不追加额度。然后nextQuestion/answer使用真正的Pi live执行器，不回退fixture。
3. 运行时通过独立credential-request请求临时Key，主进程按当前子进程对象身份、grant及引用校验后回复credential-response；取消用credential-cancel。三个私有type单独路由，不进入普通RPC待决表或公开subscribe。
4. 双方上限8个待决、每grant默认128次取用、32个活动grant、256个历史grant；默认15秒超时，收发成功前复查绝对deadline，事件循环延迟也不接受迟到秘密。grantId/credentialRef最多80字符。关闭、撤销、过期及取消清理待决；JS字符串仅解除引用，不承诺物理擦除。
5. 每个模型attempt的reserve/dispatch先落同库检查点，再允许HTTP。所有重试/修复/续写共享session总额度；费用仍按声明费率估算。取消已派发请求不等于供应商退款。
6. 重启不取Key、不自动重发。主进程须以新grantId和原version续授权后才能在新进程恢复取用；live.budget读取原额度与grant版本（撤销后也可读取version）。旧unknown必须先对账，不能通过新授权绕过。

秘密只出现于私有凭证响应和请求级内存闭包；不得转发私有帧到preload、日志、事件或模型上下文。主进程仅向渲染层提供受限业务方法。

错误响应仅`{code}`，不含原文/堆栈。未知method仅拒绝该请求；非法JSON、版本不兼容、非法帧/超限会关闭管道。stdin EOF关闭运行时；慢stdout不能无限阻止EOF清理，输出故障先停止/排空再以失败码退出，不为重发旧请求自动重启。

## 验证边界

新增local测试覆盖双岗闭环/报告、重启召回、幂等/同岗限制、候选提交间隙的**分阶段故障快照**、事件补读、旧围栏、跨事务过期回滚、junction建目录前拒绝、高版本拒绝、unknown恢复、stdio EOF及慢OS输出。分阶段快照不冒称实际断电，产物验收也不冒称系统凭证库、语音、桌面UI或真实评分质量通过。


## 本地语音方法与接线

完整方法、字段、额度和错误恢复见[本地语音运行时](client-speech-runtime.md)。session.create仅在传speech时启用语音，配置包含asrConfig/ttsConfig、各自固定budget及totalMaxCostMicros；旧会话不追加能力。LLM、ASR和TTS使用全局不同grantId、各自credentialRef，同一个私有broker协商协议。仅主进程可授权，不向preload暴露通用request。

音频走speech.upload.begin/chunk/finish；finish只验证音频，speech.asr.start才显式调用。查询speech.task.get得到transcribed后，speech.confirm原子创建正式评分任务。speech.answer.retry仅显式重试原确认的失败/中断评分，不重复ASR；原确认和每次retry回执不可变。用户换题、取消录音或收尾后，旧来源不再可提交。

speech.tts.start只读取宿主当前已发题文本，成功后speech.audio.read按32KiB游标读取24kHz WAV；speech.audio.release释放或取消。输入WAV16kHz、≤4MiB/120秒，原输入/输出字节只在有界内存；TTS输出≤8MiB、60秒TTL。重启返回AUDIO_EXPIRED，不自动合成。runtime.status的activeJobs/queuedJobs/unknownAttempts合计文字和语音，另有speechHttpAttempts/liveSpeechCalls。

语音ASR任务的job.completed表示候选转写完成，TTS表示音频生成完成；只有speech.confirm返回的answer job.completed才表示正式回答提交。公开事件按jobId区分，不能把ASR成功当作学生答题成功。

## 独立验收工具

主进程stdio协议和本地宿主不因验收工具改变。新增prepare/execute/inspect/recover及离线故障入口见[本地在线验收](local-online-acceptance.md)，冻结批次/产物/输入/来源和固定额度，一次性claim，默认不取Key或发请求。只读恢复校验原profile，不创建空用户库；源码漂移的观察不会放宽新执行门控。
