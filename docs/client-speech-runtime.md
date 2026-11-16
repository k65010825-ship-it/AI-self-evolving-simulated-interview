# 本地语音任务与客户端通信设计

设计确认：2026-11-13；实现：2026-11-14。**本地语音宿主、v3迁移和分块协议已实现，使用合成凭证/音频及注入HTTP验证；真实语音质量与硬件尚未验收。** 承接[本地宿主](client-runtime.md)、[live与凭证代理](client-live-runtime.md)。本轮仅离线实现与验证；不读Key、不调用供应商、不修改桌面或既有用户数据库。

## 1. 目标与当前能力

把学生录音→分块上传→ASR候选→学生确认→正式回答，以及当前问题→TTS→分块读取音频，迁入本地宿主。主进程负责录音设备与播放，Agent负责音频验证、题目绑定、任务/预算/确认及恢复。旧HTTP服务继续回归，不启动localhost端口。

可复用的代码：speech/wav.ts、transcribe.ts、bailian-asr.ts、omni-stream.ts、confirm.ts、validate-answer.ts、audio-features.ts、tts.ts以及既有供应商注入测试。Pi评分/规划/压缩/恢复继续复用。

不能原样复用speech/task-manager.ts的存储装配：它自建SQLite连接及独立任务fence，不能作为本地profile正式围栏的第二个数据库。现有ASR账本的responded只表示收到结果，不等于实际费用已核验；TTS只有派发/响应/unknown钩子，尚无完整本地持久账本。

本地已实现文字宿主、live接入、语音上传、转写确认及播报分块，并以本地stdio和注入HTTP验证。系统凭证库、物理设备与真实语音质量尚未验收；旧HTTP成功不替代本地链路验收。

## 2. 方案与取舍

| 方案 | 取舍 |
| --- | --- |
| 推荐：分块stdio＋本地单库宿主 | 延续既定父子进程边界；没有任意路径接口；需要新增传输状态与同库语音任务/预算 |
| 主进程传临时文件绝对路径 | 少一次base64转换，但引入文件归属、junction、打开/替换竞态和清理协议；不采用 |
| 原语音HTTP manager在本机启动 | 复用入口较多，但保留第二数据库、服务token与端口；不符合已确认的本地宿主方向 |

分块stdio与单profile为已确认方向；具体字段、v3升级和固定子额度方案也已获用户确认。

## 3. 音频与题目绑定

上传使用32KiB二进制块的规范base64，每帧仍受1MiB限制。仅接受单声道、16kHz、16位PCM WAV，完整文件≤4MiB且时长≤120秒；沿用inspectWav的实际字节解析，不能只信客户端头部。完整SHA256、byteLength在登记时固定，finish时复核。禁止任意path、URL、userId、题目正文或provider参数。

begin由宿主读取当前workflow，生成audioId/answerId，并固定sessionId、questionId、revision、profileId与有效期。每会话最多一个活动录音上传；全profile最多两个活动上传，总原始缓冲≤8MiB，等待窗口≤60秒，不越过会话截止时间。

槽位与字节额度覆盖uploading、已finish待ASR、ASR执行中三类状态；finish不释放持有WAV的槽位。ready等待也受原60秒期限约束。取消执行中的任务只撤销资格，speech-transport跟踪fetch、body.read与body.cancel的真实完成；即使适配器Promise.race提前结束，底层worker未退出前仍占用执行/音频槽。永久不响应的依赖会占槽直到有界关闭/主进程终止自己的子进程，不声称远端已停止。这里的8MiB是原始缓冲额度，不是整个进程内存硬上限，base64、请求体和解析副本须另做有界测试。

chunk要求严格递增index；精确相同的末块重放幂等，不同内容或跳号拒绝。哈希计算以实际收到的完整字节为准；上传完成不会自动触发ASR。startAsr单独明确受理，避免重传finish隐式收费。

原始输入WAV只在有界内存，处理完成、取消、超时或EOF后解除引用，不写盘。上传元数据/块回执可持久化，但不宣称进程重启可续传原音频；重启未完成上传标interrupted，需要新的显式录音操作，旧operationId重放不自动重录或收费。

音频字节不通过公开事件推送；输出由主进程显式按游标拉取。TTS生成结果首版也只在内存，最多8MiB/项、全profile最多两项、完成后保留最多60秒；重启/过期后audio.read返回AUDIO_EXPIRED，不自动重新合成。任务完成表示生成结果曾成功，不表示音频跨重启可播放。

TTS槽位在派发前占用，包含生成中和待消费结果，不能先调用再检查容量。输入WAV是16kHz，TTS沿用供应商适配器输出的24kHz单声道16位WAV，客户端根据返回的格式/采样率播放，不能拿上传校验器错误拒绝输出。

## 4. 已实现的业务接口

配置/授权契约见packages/contracts/src/local-speech.ts，方法和视图见packages/contracts/src/local-speech-api.ts；机器定义见[local-speech-schemas.json](local-speech-schemas.json)。runtime.initialize发布local-speech-v1能力。

| 方法 | 主进程输入与结果 |
| --- | --- |
| speech.upload.begin | operationId、sessionId、expectedRevision、byteLength、sha256 → audioId与块大小；宿主绑定当前题 |
| speech.upload.chunk | audioId、index、base64 → nextIndex；非规范编码或超额拒绝 |
| speech.upload.finish | audioId → 上传完成回执；验WAV/hash，不发ASR |
| speech.asr.start | operationId、audioId、expectedRevision → jobId；显式授权后派发一次 |
| speech.task.get | jobId → 本人本机可见转写、版本、状态；不返回内部凭证或原始账本快照 |
| speech.confirm | operationId、jobId、expectedVersion、expectedRevision、text → 正式answer jobId |
| speech.answer.retry | 新operationId、失败/中断的原评分jobId、expectedRevision → 新评分jobId；仅显式重试原确认答案，不重复ASR |
| speech.tts.start | operationId、sessionId、expectedRevision → jobId；宿主取当前已发题文本，禁止自传任意text |
| speech.audio.read | jobId、offset → 有界base64、nextOffset、eof、mimeType；offset须对齐块边界 |
| speech.audio.release | audioId或已完成TTS jobId → 幂等释放内存；不删除预算/任务回执 |
| speech.authorize/revoke/budget/reconcile | 同LLM的受信授权/CAS/查询/对账模式，显式区分ASR、TTS能力 |

统一job.get/cancel/events查询任务生命周期，继续先落库再通知。取消释放内存与结果资格，已派发消耗不退款；重放确认回执不会再次评分。会话complete时取消未提交语音候选，不擅自把转写当答案。

## 5. 转写确认与正式回答

ASR只生成候选：保留原转写、音频摘要、确认文、来源/provider/model与当前题绑定。学生可修改确认文，修改产生明确差异警告。只有speech.confirm才能把来源候选接入原workflow answer；客户端不能提交伪造transcript/speech对象。

确认事务重读任务状态、版本和当前workflow revision。只有同一题、同一原revision、未取消/过期的transcribed任务可确认。正式评分任务从宿主读取候选并构建TurnInput；评分失败、澄清、弃评均沿用现有分支，不能先提交能力分再等待模型。

确认接受时固定原ASR来源及确认文本，后续幂等重放只能返回同job；不同文本必须冲突。最终提交在同库原有协调器中完成：会话、能力/记忆变化与唯一回执仍经身份、题目、版本、期限与fence检查。ASR成功不等于回答完成，confirmed不等于已正式评分。

确认状态/确认摘要、唯一confirmationId、评分local_job及operationId回执必须在同一写事务产生。一个候选只有一个确认入口，不同operationId不能重复确认。评分失败/中断时重放原确认只返回原任务；显式speech.answer.retry验证原任务确已失败/中断、无未知账目、当前题/revision未变且尚无正式答案，再按剩余额度创建后继任务，携带同一确认来源。每条确认链只能有一个活动评分任务和一个正式答案回执。

持久化评分请求由宿主注入原speech候选；最终提交时重读同库确认摘要与session/question/revision绑定，验证未取消且来源未替换。不能只依赖SpeechAnswerSchema，因为其自身不包含会话/题目/revision。文字抢答、语音确认、收尾与取消竞争均由同库CAS决出唯一提交者。

表达分析复用音频描述特征及原expression-assessment边界。没有可信清晰度/自信度模型时保持未评估；修改确认文不能被说成真实语音表达，也不把合成音频变成人类表现证据。

## 6. 凭证和固定总额度

LLM、ASR、TTS可能使用不同平台/模型/端点与Key。沿用私有credential-broker-v1机制，但每种能力有独立、不可混用的grantId/credentialRef和配置摘要；不假设现有LLM Key通用，也不从.env或全局设置读取。主进程resolver依据明确的绑定从系统凭证库读取，具体凭证库接线仍由桌面队友负责。

新建语音会话在创建时显式声明固定资源预算（落地字段为speech.totalMaxCostMicros、asrBudget、ttsBudget，LLM子额度仍是sessionBudget）：币种、全会话cost上限、LLM/ASR/TTS各自上限，以及ASR音频时长/TTS字符数和HTTP次数。各能力声明费用上限之和不超过全会话上限，不自动借用其他能力额度。既有sessionBudget保持LLM语义；没有resourceBudget/speech配置的旧会话继续文字模式，不在旧不可变预算上偷偷追加语音能力。

resourceBudget中的LLM子额度必须与原sessionBudget一致；LLM、ASR、TTS的reserve/dispatch都进入同一个本地事务准入，不能只对语音查总额度。现有live-store的checkpoint、派发及profile unknown检查同步扩展，既有LLM unknown阻断语音，语音unknown也阻断LLM。实际超用完整入账后锁定新的付费准入，不能裁剪记录来维持预算数字。

配置保存不授予调用权限。每种speech grant只能绑定该session及预声明能力/配置，期限≤原会话期限，CAS续期不增加额度；撤销/重启使当前进程授权失效。LLM恢复尝试继续累计原model账本，语音attempt同样按session/capability/job/run/attempt/callId绑定原授权。

reserve→dispatch先持久化，再允许供应商HTTP。跨job、重录、新grant、重启均累计已占用次数、音频时长/字符量、used+held费用。任一能力的unknown阻断profile新的付费派发；离线读取、取消及已有结果查看不受阻。

ASR/TTS现有usage不等于可核验人民币金额：首版保留宿主声明的每attempt固定费用预留，收到完整响应记responded并继续占用该费用额度，不伪造settled或退款；未知记unknown。受信主进程可提供明确证据与版本进行对账，但正式供应商账单核验仍单独标false。若将来提供可信token/时长费率计算，需固定pricingVersion后显式支持，不从响应猜费用。

新增本地attempt适配器负责reserved→dispatched→responded/rejected/unknown，不直接把ASR原快照套入LLM状态机。旧ASR首次checkpoint就是dispatched，同一响应还可能追加usage；本地适配器先保存reserved，映射重复checkpoint为幂等元数据更新。TTS由宿主分配callId并在回调闭包绑定，HTTP拒绝记rejected并保留已派发额度，解析失败/结果不明记unknown，不将onResponse直接等同成功。

首版对账可以记录用量/证据并把unknown改成有据的responded或rejected，但不减少累计调用/音频时长/字符数，也不释放已派发费用预留；不得通过重复对账重新获得预算。只有明确未派发的reserved可释放金额预留。供应商退款/实付差额的额度返还属于后续显式设计，不在本轮自动支持。

## 7. 同库v3与恢复

新增local_speech_tasks（包含上传元数据）、local_speech_attempts、local_resource_budgets、local_speech_grants和对账/幂等回执；与LLM/正式会话使用同一profile连接/事务/fence，不使用旧speech_tasks独立文件。

迁移扩展为v1→v3、v2→v3：先持有效profile租约、生成原版本一致性备份并独立校验，再同事务DDL/user_version=3。备份/DDL失败保持原版本，不自动覆盖回主库；旧会话/记忆/LLM额度/grant/回执及legacy unknown逐字保留。空库直接v3，高版本拒绝。备份路径继续拒绝junction。

启动不构造供应商、不取Key、不重发。未完成上传标interrupted且不能续传；reserved释放，dispatched无可信结果转unknown保留预留，包括已取消/失败任务。已完成ASR原文可读取，确认前仍验证当前题与期限；已有正式回执零调用重放。已完成TTS音频不在内存时只返回过期，不重新收费生成。

上述上传中断也包括已finish但未ASR、以及执行中仍持有WAV的状态。确认已受理但未完成评分，恢复原评分job为interrupted或按既有合法候选提交规则处理，不重新创建任务；用户需要继续时走明确的speech.answer.retry，不重放确认隐式收费。

只有当前owner可接纳usage/对账，旧进程迟到转写或播报结果不能写入；同库预算判断失败保证HTTP=0。取消不能保证供应商停止或退款，不能宣传外部恰好一次。

## 8. 分步实施和验收

1. 契约、v3备份迁移、同库音频/任务状态及预算，不改桌面；先验证真实v1/v2升级/失败回滚、旧数据保留。
2. 有界分块上传/拉取、重复/乱序/hash/格式/内存上限、EOF清理与重启丢失字节语义，所有上传操作HTTP=0。
3. 复用ASR/TTS provider，接私有凭证、逐attempt同库预算和受控对账；用合成resolver/注入HTTP验证，不读真实Key。
4. 接正式回答、澄清/弃评/收尾/记忆；双岗真实stdio链路验证音频题目绑定、修改确认文、幂等评分、取消与unknown。
5. 正式sidecar与独立test-only产物分离，从异cwd运行双岗合成WAV→转写→确认→评分→播报，并验证重启不重发。正式产物不能含fixture网络或合成Key。
6. 运行typecheck、test、pi:offline、check:knowledge、openapi:lint，核验文档/产物摘要；原教程模块就地更新，新增模块仅在真实实现后编写，问题记录和模拟周报保留证据边界。

本轮默认不做真实供应商/真人识别率/物理麦克风/系统凭证库/安装器验收。真实调用须另行冻结供应商、凭证来源和预算；历史批次授权不自动续用。


## 开发验证入口

```powershell
bun run agent:local:speech:acceptance
bun test tests/local-speech-host-boundaries.test.ts tests/local-speech-transport.test.ts
```

第一条构建单独injected-test-only产物并实际spawn，双岗合成输入、真实Pi、注入LLM/Omni-ASR/TTS HTTP，重启验证原文/记忆/费用占用及音频过期。它不是生产sidecar、安装器或真人识别测试。正式产物仍由agent:local:build构建；不包含实验transport或合成Key。
