# 语音转写适配与表达特征

## 当前能力与调用边界

已实现独立宿主函数：内存 WAV → 注入 ASR provider → 原始转写与能量特征 → 学生确认文候选；新增可选[内部上传/确认任务HTTP](speech-tasks.md)及SQLite幂等/检查点，后续pilot入口现已接入正式API授权，见[pilot运行](pilot.md)。Pi评估仍使用文本。当前选择[千问Omni流式转写](asr-service.md)，保留百炼兼容；2026-11-06完成1次4.22秒本机合成英文语音真实HTTP200转写，94 token，不代表真人/中文质量。Electron虚拟麦克风与正式业务上传已通过本机试点验证；实体麦克风、真人质量、压缩音频转换和真实账单尚未验收。

`bun run agent:speech:demo` 演示 Java 后端与 Web 前端。音频是程序生成的正弦波/静音，转写是手工 fixture；不是语音识别效果测试。真实字节解析、时长/能量计算、契约校验与取消逻辑可运行，`liveModelCalls=0`。确认候选已能通过 TurnInput.speech 接入内部 turn/report 任务与报告。无语音的报告保留 not_evaluated；有语音则输出 audio_descriptions，具体约定见下文“运行入口与报告联动”。

公共真值 `packages/contracts/src/speech.ts`，机器定义 [speech-schemas.json](speech-schemas.json)，由 `bun run openapi:generate` 同步。Zod 跨字段校验不能全部表达为 JSON Schema，宿主仍须调用真实函数校验。

## 宿主函数契约

| 函数 | 输入 | 输出与职责 |
| --- | --- | --- |
| inspectWav(bytes) | Uint8Array，仅内存字节 | 有界PCM视图；无路径、URL或外部进程访问 |
| analyzeAudio(pcm,options?) | inspectWav结果；可选rmsThreshold | 能量活动、首尾低能量时长和内部间隔候选 |
| transcribeSpeech(input,deps,signal?) | context、transcriptionId、audioId、wavBytes；deps.provider必填 | uncommitted-speech-transcript，包含原文/时间段/音频摘要/表达描述 |
| confirmSpeechAnswer(transcript,confirmation) | 可信原始转写与确认请求 | uncommitted-speech-answer；保留原文与确认后的answer{id,text} |

context 沿用 ToolContext，包括 userId/runId/attemptId/roleId/deadlineAt；ASR 元数据另限制 userId 等标识最多100字符。API 应分配 transcriptionId/audioId、核对音频所有权、保存不可变源记录，并从身份态注入 context。哈希关联内容，不是身份签名。函数不读环境密钥或全局 SDK 配置。

provider 是宿主依赖：`{id,version,mode,transcribe({wavBytes,durationMs,sampleRate},signal)}`；mode 为 offline-fixture 或 live-asr。已有本地fixture与千问/百炼适配器，启用/独立凭证/预算及小样本边界见[ASR接入](asr-service.md)。真实调用需明确授权、凭证来源和预算。返回先按 AsrOutputSchema 校验：text≤10000字符，language为zh-CN/en-US/mixed/unknown，segments≤500，每段startMs/endMs/text，可选ASR confidence。Omni没有可靠对齐/语种元数据时输出空segments和unknown；时间段须顺序不重叠、正长且不越过音频；段落置信度绝不当学生自信。

## 音频与计算口径

仅接受 RIFF/WAVE、标准16字节 fmt、PCM编码1、单声道、16kHz、16位小端、blockAlign=2、byteRate=32000；空样本、奇数字节、重复fmt/data、截断chunk或RIFF长度不符拒绝。未知chunk可按长度跳过并检查奇数padding。最多4 MiB和120秒；不支持WebM/Opus/MP3、浮点WAV、扩展fmt、立体声或自动重采样。客户端录音格式与转换归后续联调确定，不能直接把MediaRecorder默认输出当此WAV。

20ms帧计算RMS，默认阈值0.015（可配置0.001—0.5），逐样本归一为 PCM/32768。大于等于阈值的帧计入activeAudioMs，内部低能量连续区间≥300ms记录为internalPauses。首尾静音单独计数，不算内部停顿；全静音全部计leading，trailing=0，避免重复计时。尾部不足一帧按实际样本计时。此算法没有语义语音活动检测，噪声/音乐也可能被判活动；输出明确携带 rms_activity_is_not_semantic_speech，不据此给好坏评价。

汉字逐字算一个单位，连续ASCII字母/数字算一个单位；标点空白不计，例如 `Java 并发 retry 3次` 为6个单位。使用原ASR文本，学生确认修改不重新计算语速；不声称词/音节/字在跨语言之间可比。

- unitsPerMinute = 原转写单位数 × 60000 / 全音频毫秒。
- unitsPerActiveMinute = 原转写单位数 × 60000 / 能量活动毫秒；它不等同真实发声语速。
- 音频至少3秒、能量活动至少1秒、至少4个计数单位且无不支持脚本时返回 descriptive；否则 insufficient_data，两个速率均为null，保留可核对的物理描述。
- clarity、confidence、emotion 始终null。ASR错字与幻觉会影响速率，这不是发音清晰度、沟通能力、心理状态或情绪评分。

## 原始转写与确认

SpeechTranscript保留schemaVersion、用户/岗位、provider/version/mode、startedAt/completedAt、audioId/SHA-256/字节数/格式/时长、originalText、segments和expression。SHA-256对完整原始WAV计算，provider收到独立副本，不能修改已计算源摘要或分析输入。

确认请求 `{transcriptionId,audioSha256,userId,roleId,answerId,text,confirmedAt}`，必须匹配源的ID/hash/用户/岗位，confirmedAt不早于完成时间；确认文trim后1—10000字符。确认函数重新核对由原文及已存音频特征推导的描述，不允许只改unitCount冒充新结果。返回副本不修改源；文字有变化附confirmed_text_differs_from_asr。空ASR可保留为数据不足候选，确认文仍须非空。

这些是结构/关联保护；API仍须从数据库加载真实源、保证用户身份与时间、保存确认版本和正式answer。客户端提交一份结构正确的JSON不代表原音频或provider声明真实。不得直接信任学生提供的expression、sourceMode或userId。

## 错误、取消与预算

输入/格式/时间错误为VALIDATION_ERROR，音频超限为CONTEXT_BUDGET_EXCEEDED；ASR结构和时间段不合法为MODEL_OUTPUT_INVALID，供应商未知异常静态化为DEPENDENCY_UNAVAILABLE，不返回原始异常。确认错用户FORBIDDEN、错岗位ROLE_FORBIDDEN、错转写ID/hash为VERSION_CONFLICT。

默认10秒provider预算（可配置1—30000毫秒），受宿主deadline共同约束。预取消不调用provider，显式取消为RUN_CANCELLED；超时为DEADLINE_EXCEEDED。Promise.race、AbortController和等待后再检查共同防止忽略信号的provider迟到返回候选；finally释放监听器与timer。没有自动收费重试。依赖若忽略信号仍可能后台运行，未来部署还须加并发/供应商限流；当前独立函数不构成持久任务队列。

## 运行入口与报告联动

`bun run agent:speech:runtime:demo` 演示两岗：先生成合成音频/手工ASR确认候选，再通过真实本机TCP调用内部turn → SSE → report。内容评分使用真实Pi SDK本地替身，真实ASR/模型调用0，不提交业务数据库。该命令需要允许本机网络连接。

内部 `/internal/v1/runs` 的 `job.type=turn` 沿用已有输入，新增 `job.input.speech?: SpeechAnswer`。纯文字请求不提供此字段。宿主把确认后的 `speech.answer` 同时绑定到 `input.answer`，并保存整份不可变输入快照；不得只更新正文后继续沿用旧语音材料。无需新增job类型或事件，音频字节不进入此JSON请求，仍受原2MiB请求体预算约束。

评分前 `validateSpeechForTurn` 检查源userId/roleId与当前context、候选answer.id/text与input.answer、session开始/转写开始/确认/评分时刻；重建确认候选并比较原文推导的expression和warnings，不信任候选中重复提供的副本。错身份为FORBIDDEN/ROLE_FORBIDDEN，回答不匹配为VERSION_CONFLICT，时序/描述篡改为VALIDATION_ERROR。内部运行可能先返回202，执行期失败再写失败快照；不能只把接受任务当作评分成功。Pi只收到确认文与原内容评估上下文，不接收原ASR、音频hash、provider数据或音频速率，不用这些字段改变技术评分与quality。

`buildInterviewReport` 在每条原observedAt重验相同绑定，而不是用较晚generatedAt允许事后确认；同时拒绝一份transcriptionId或audioId出现在两个回答中。按观测顺序输出，输入turns可无序；重复hash本身不证明同一录音，当前只核对源标识唯一，API须负责真实采集/归属和问题绑定。所有校验都不能代替鉴权、源签名或数据库事实。

expression 为区分联合：

| status | 含义与字段 |
| --- | --- |
| not_evaluated | 无关联语音，reason=no_confirmed_audio；兼容读取旧reason=audio_and_expression_evaluation_not_integrated。保留speechRate/clarity/confidence=null。 |
| audio_descriptions | scope=audio-timing-only；coverage列出totalAnswers/speechAnswers/textAnswers/descriptiveAnswers/insufficientAnswers；answers逐回答列来源及features。整体speechRate/clarity/confidence/emotion=null。 |

每条answers包含answerId、questionId、transcriptionId、audio元数据（含hash）、provider/version/mode、confirmedAt、originalText、confirmedText、features与确认文变化warnings。低数据量记录仍保留，features.status=insufficient_data且速率为null；不把它排除后冒充完整覆盖，不将文字回答补造为音频。没有全场平均速率、表达总分、情绪或自信分。

内容report.evidenceMode只表示技术评分来源；expression.speechEvidenceMode单独为offline-fixture/live-asr/mixed。有离线语音加contains_offline_speech警告。即使内容来自真实模型也不代表语音是真实ASR，反之亦然。测试中模拟这些声明仅验证分支，不证明供应商实际调用。

报告是服务端未提交候选，包含原/确认文和原有量规等敏感材料。业务API须裁剪成学生本人可见内容并进行鉴权，不能把内部快照直接转发renderer。SSE仍只发送既有阶段、题目和终态，语音原文、确认文、音频hash及评分量规不进入事件流。
