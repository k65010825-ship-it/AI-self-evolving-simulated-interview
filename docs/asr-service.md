# 语音转写服务：千问 Omni 与百炼兼容

## 当前实现与入口

`createAsrProvider(config, dependencies)` 实现 `SpeechProvider`，接入已有 `transcribeSpeech → confirmSpeechAnswer → turn/report`；旧导出 `createBailianAsrProvider` 保留兼容。当前用户选择千问 AI 平台北京地域 `qwen3.8-omni-flash`，端点为 `https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1`。`POST {endpoint}/chat/completions`，WAV 以 `data:audio/wav;base64,...` 内联发送，流式接收文本，完整结束后才生成转写候选。旧百炼 `qwen3-asr-flash` 同步 JSON 分支保留；两类模型/平台/端点严格配对，不静默切换供应商。不上传到公共 URL 或 OSS，不依赖 Pi 工具调用。

依据：[千问 Omni 官方文档](https://docs.qwencloud.com/developer-guides/speech/multimodal-speech)、[百炼 Qwen-ASR 官方 API](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference)，2026-11-06 经 MarkItDown MCP 读取核对。Omni 支持内联音频和文本输出，默认思考已在本适配器显式关闭。音频理解模型通过固定提示执行逐字转写，不等于专用ASR准确率保证；仍必须允许学生确认。旧百炼地域/空间域名与当前千问北京域名分别限制。

```powershell
bun run agent:asr:preflight
bun run agent:asr:preflight --config .cache/asr-service.json
bun run agent:asr:demo
bun run agent:asr:acceptance
```

预检只检查配置，不读取任何凭证或发请求，**无 `--execute` 开关**。demo 用真实适配器、注入 HTTP、正弦波/静音和手工转写演练两岗确认；`selectedProviderMode=live-asr` 只表示选中的传输适配器，`liveAsrCalls=0`，不能当成识别质量或联网成功证据。

`agent:asr:acceptance` 默认也是 plan-only，不读 Key、不发请求；只有显式 `--execute --config <文件> --audio <本地WAV>` 才执行受限验收。必须独立启用配置、允许真实调用、授权未过期且≤10分钟；严格限定1请求、≤10秒音频、≤512输出token、总/单次预留均100000微元。无失败自动重试。CLI 在 `.cache/asr-live/run-*/` 写入 intent 和结果（含转写，属于运营方本地敏感材料），不复制原音频，控制台只输出摘要/产物位置，不展示 Key 或供应商原始异常。新建进程会重建预算，本命令并非账号级限额或持久任务恢复。

`AGENT_MODE=live-service` 不会自动启用 ASR。已有宿主函数、受限验收和可选[内部语音上传/确认接口](speech-tasks.md)，后者需宿主注入授权回调；后续pilot入口已接正式上传/登录与Electron录音，真实TCP/SQLite及虚拟麦克风已验证；实体设备、真人识别准确率与供应商账单仍未验收，见[pilot运行](pilot.md)。

## 配置与凭证

共享真值：[asr-service.ts](../packages/contracts/src/asr-service.ts)，生成定义：[asr-service-schemas.json](asr-service-schemas.json)。默认关闭示例：[qianwen-omni.example.json](../apps/agent/src/speech/qianwen-omni.example.json)；旧百炼示例：[bailian-asr.example.json](../apps/agent/src/speech/bailian-asr.example.json)。复制到 `.cache/asr-service.json` 后由宿主管理，不把密钥写入 JSON。

| 配置 | 作用 |
| --- | --- |
| enabled / authorization.allowLive / expiresAt | 必须同时允许且未过期；配置本身不能替代运营方授权 |
| providerId / modelId | 当前qianwen / qwen3.8-omni-flash；兼容bailian / qwen3-asr-flash |
| endpoint | HTTPS、无认证/端口/query/hash；千问仅指定北京端点，旧百炼限定官方空间或DashScope域名；拒绝重定向 |
| credentialEnv | 固定 `INTERVIEW_BAILIAN_ASR_API_KEY`（保留历史变量名），当前值来源已由用户更正为千问平台；仅实际调用前解析 |
| timeoutMs | 1—30000 毫秒，与 context.deadlineAt / 授权过期取最短期限 |
| maxOutputTokens | Omni为1—4096，默认512；小样本验收最多512，发送max_tokens |
| budget.maxCalls | 此 provider 实例累计派发次数，最多100 |
| budget.maxTotalAudioMs | 此实例累计派发的音频时长 |
| budget.reserveCostMicrosPerCall / maxCostMicros | 每请求声明预留与累计预留上限；人民币微元，1元=1000000微元 |

独立 ASR Key 须匹配选择的平台/地域；变量名保留以免要求用户重新填 Key，不以变量名称推断来源。不回退读取 `INTERVIEW_QIANWEN_API_KEY` 或全局 SDK 设置。当前Omni示例每次/总共预留100000微元（¥0.10），**是宿主声明预算，不是供应商当前费率、真实结算金额或实际扣费硬上限**；没有把未知真实费用按0结算。实际多用户使用前必须核实费率、时长与账号限额。

## 宿主契约

依赖 `{context, readCredential, fetch?, now?, onCheckpoint?}`。`context` 为宿主注入的 ToolContext，provider 实例绑定该运行上下文，不跨用户/任务复用；宿主在 `transcribeSpeech` 中传相同 context。模型和学生不能创建 provider、设置端点、预算或凭证来源。

每次调用重新校验 PCM WAV（单声道16kHz/16位，≤120秒/4MiB），拒绝伪造 durationMs/sampleRate。预取消、关闭/过期、非法 WAV、额度不足都在读密钥/派发前拒绝。Omni 请求是单条user消息中的音频（format=wav）与固定“逐字转写、不总结/翻译/回答问题”指令，`stream=true / stream_options.include_usage=true / modalities=[text] / reasoning_effort=none / max_tokens`。旧百炼分支维持 `stream=false / enable_itn=false`。不传题库、参考答案或评分量规，避免转写受正确答案污染。

Omni响应体≤256KiB、≤4096个data事件、文本≤10000字符；有界接收后严格UTF-8解码/SSE解析，支持任意字节分片及CR/LF行结束，只有实际空行才完成事件，EOF残余不补齐。仅choice0、一次stop，再允许一次usage和完整 `[DONE]`；拒绝工具/拒绝/非空reasoning、重复终止、结束后数据、length或断流。缺失usage不补0；非法usage拒绝，不重试或修复。旧百炼仍为≤64KiB完整JSON。两者都不把部分文字或错误消息当原文，不续写转写。没有可靠语种/对齐信息时 `segments=[] / language=unknown`，不虚构时间戳、语言检测或置信度。合法空转写保留为不足以评价，确认文仍须非空。

原始转写/确认文/音频摘要/表达特征沿用 [speech.md](speech.md)。ASR confidence 不等于学生自信；清晰度、心理自信、情感仍为 null。API 必须鉴权、加载真实源并正式提交，结构合法不能替代真实性。

## 预算与故障

`accounting()` 返回脱离内部对象的快照：context、调用数、累计音频时长、预留费用及逐请求状态。无音频字节、转写文本、Key、原始供应商异常或提示词。HTTP 200 的合法 usage 可保存 token 元数据，缺失/非法 usage 不补0；从不据此宣称已结算真实语音账单。

- dispatch 前先增加完整预留，并同步调用关键 `onCheckpoint(snapshot)`；失败不派发，实例阻断。回调收到副本，不得返回 Promise。
- `dispatched → responded`：旧百炼完整HTTP读完后还需输出校验；Omni要求完整SSE解析成功后才进入此状态。不等于真实费用结算，预留继续保留。
- `dispatched → rejected`：明确非2xx响应；不展示原始错误，不自动重试，继续保留整次请求、时长和费用预留。
- `dispatched → unknown`：网络失败、超时/取消、响应未读完或结果不明；保留预留并阻断后续派发。
- 原期限、AbortController、Promise.race 和返回前检查共同拒绝迟到结果；同实例最多一个在途请求。不自动重跑转写，以免重复费用。

**单独ASR provider的gate仍是进程内状态**，创建新实例会建立新预算，不能宣称账号级限额。通过[语音任务manager](speech-tasks.md)启用独立SQLite操作表后，可持久化ASR检查点/幂等结果，重启隔离中断任务且不自动重发；这与LLM的操作表独立。ASR真实费用结算/释放/对账仍未实现，多用户累计配额和正式业务授权须由宿主落实。

## 验证与下一步

`tests/asr-provider.test.ts` 和 `tests/asr-omni.test.ts` 覆盖双岗确认、精确HTTP请求、平台配对、UTF-8/SSE分片与EOF、不合法输出、取消/超时、未知消耗阻断、费用预留、快照副本及验收证据边界。自动测试均注入HTTP。

2026-11-06已做一次受限真实请求：Windows Zira本机合成英文语音4.22秒，HTTP200，转写为“Java transactions should roll back when an operation fails.”，与合成脚本相同；返回input83/output11/total94 token。产物 `.cache/asr-live/run-efd82171-58f7-420f-b0f7-7cef2663055a/report.json`；本次授权配置已关闭。真实Key未输出，未改LLM授权，¥0.10预留未当实际费用结算。该证据只验证这一条合成语音的鉴权/音频输入/转写，不证明中文、真人噪声/术语准确率、业务上传、GUI、正式提交或供应商账单。

下一步接内部音频上传与转写确认，再用同意上传的真人中文/技术术语语音做独立质量验收；ASR持久幂等与费用对账仍需落实。
