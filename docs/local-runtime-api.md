# 本地客户端接入契约

面向 Electron 主进程和本地业务接线。实现与源 schema 位于 feature/agent；本文保留跨团队接入要求，不展开 Pi、存储算法、压缩或内部评测实现。机器定义：[RPC schema](local-runtime-schemas.json)、[语音 schema](local-speech-schemas.json)。

## 1. 启动与权限边界

使用 `@interview/local-agent-client` 的 `spawnLocalAgent({executable,entry,dataDir,assetsRoot,cwd})`。主进程传包内 bun.exe、runtime.js、独立用户目录及只读安装资源目录；使用绝对路径、无 shell、隐藏窗口。目录不能互相包含；路径由主进程配置，renderer/RPC 不得自行改变。不启动 localhost HTTP。

`client.request(method,params)` 返回响应；`client.subscribe(fn)` 接收公开事件；`client.waitForJob(jobId)` 查询终态；`client.close()` 请求排空，超时仅终止自己创建的子进程。preload 只暴露具体业务方法，不暴露通用 request、spawn、SQL、文件路径或私有凭证帧。

先调用 runtime.initialize，再调用业务方法。SDK 不继承个人 Key、全局 Pi 配置或 .env。未配置凭证时可以离线开发，但 offline-fixture 结果不得标作真实模型成绩。

## 2. 帧、任务与状态

UTF-8 JSONL，protocolVersion=1；stdout 仅协议，原始 stderr 不直接显示给学生。单帧≤1MiB，回答≤10000 字符，最多 8 个在途请求。

```json
{"protocolVersion":1,"type":"request","id":"req-1","method":"session.get","params":{"sessionId":"session-id"}}
```

公开事件包在 `{protocolVersion:1,type:"event",event:{jobId,seq,status,stage}}` 中。任务受理返回 jobId，queued/running/candidate-ready 不是正式提交；completed 后读 session.get 确认结果。job.events 按 afterSeq 补读持久事件，每次最多 100 条；不承诺通知恰好一次。

写命令用 operationId 幂等，重放同内容返回原 job；同 ID 异内容 VERSION_CONFLICT。request.id 只关联响应。session.get 的 revision 和 lastOperation 用于旧版本拒绝及 ACK 丢失后的恢复；不要超时就换 operationId 再提交。

## 3. 文字面试与只读查询

| 方法 | 参数 / 结果 |
| --- | --- |
| runtime.initialize/status/shutdown | 初始化能力、运行状态、受控关闭；初始化不读取 Key |
| roles.list | 双岗 id/label；六技能展示目录尚待补齐 |
| session.create | operationId、roleId、goal、durationMinutes（15—25）、pressure?、mode?、liveConfig?、sessionBudget?、speech? → jobId/sessionId |
| session.list | offset? / limit?（1—100）→ 会话视图数组 |
| session.get | sessionId → revision、phase、deadlineAt、当前题、answeredCount、priorEvidenceCount、report、lastOperation、mode、authorizationStatus |
| session.nextQuestion | sessionId、operationId、expectedRevision → jobId/sessionId |
| session.answer | 同上＋text；身份/当前题由宿主绑定 |
| session.complete | 同 nextQuestion；正常收尾并保存报告/记忆 |
| memory.get | roleId → 本机本岗有界记忆；不要直接把内部结构当最终画像页面 |
| job.get/cancel | jobId → 任务视图；取消不表示供应商退款 |
| job.events | jobId、afterSeq? → 有序公开事件 |

当前会话视图尚缺独立澄清提示、逐轮反馈和完整报告证据投影，前端不能凭 phase 或回答长度自行判断分数。新增能力见[接口导航](api.md)。提示目标为每题2次有效提示、不扣金币；尚无提示RPC，前端不能自行拼接未知方法。同岗位只允许一场未完成、未过期会话；不同岗位可以并行。

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

| 情况 | 接线行为 |
| --- | --- |
| VERSION_CONFLICT | 重新查询正式 revision/原操作，不能覆盖或重复奖励 |
| ROLE_SESSION_ACTIVE | 展示/继续已有本岗会话，不反复创建 |
| PROFILE_BUSY / PROFILE_FENCED | 拒绝双宿主写同一 profile，不删用户库或靠 PID 强解锁 |
| 授权失效 / 额度耗尽 / BUDGET_RECONCILIATION_REQUIRED | 展示原因，受信主进程续授权或对账；不重置消耗 |
| interrupted / 管道断开 / 通知丢失 | 重启后查询任务/会话并补读事件；不自动重新执行收费动作 |
| AUDIO_EXPIRED / 旧录音不可恢复 | 明确需要新的录音或播报操作，不显示假音频 |

错误公开响应只含 code；诊断不代替评分说明。退出不自动删数据，换号不静默接管旧 profile。账号/profile 隔离、硬件、系统凭证库、非开发机安装和真实质量仍需独立验收，见[产品验收计划](evaluation-plan.md)。
