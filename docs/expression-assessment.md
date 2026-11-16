# 独立语音表达评估适配器

这是独立的、默认不参与正式综合分的模型估计能力。它不改变现有报告、工作流、API 或桌面产品路由；没有运行真实付费调用，也没有验证模型的语音判断准确度、音频证据对齐或人群公平性。

## 输出语义

`status` 永远是 `unvalidated-model-estimate`；`reliabilityValidated` 与 `usedInFormalScore` 永远是 `false`。另用 `dataStatus` 表示 `sufficient_data` 或 `insufficient_data`，避免将“数据够形成候选估计”误称为“估计可靠”。

三个维度是 `clarity`（可听辨清晰程度）、`confidentDelivery`（可观察的表达坚定程度）、`vocalValence`（声音听感倾向）。均为 0–4 的待核验估计或 null。表达坚定程度不等于内心自信；声音听感不构成情绪、人格或疾病诊断。固定 prompt 禁止这些推断，schema 不接受额外心理评分字段，但这不证明模型文字说明已经经过独立语义核验。

每个非 null 维度必须带至少一个证据区间与原始转写逐字引语。区间不能超出真实 WAV 时长，至少覆盖 300 ms；引语必须在调用前快照的 `originalText` 中精确存在。这里只能机械检查时长与逐字包含，**不能证明引语确实发生在那个时间区间，也不能证明声音判断正确**。警告字段明确保留这一边界。

源信息包含完整音频 SHA-256、固定模型 ID 与 WAV 时长。正式分数、知识评分与学习结论不读取此模块。未来任何可靠标签、计分权重或产品接入，都需要先完成独立人工标注、分组质量/公平性评测与审核；当前 schema 没有将标记改为 reliable 的开关。

## 调用边界

`createExpressionAssessor(config, deps)` 固定使用与当前 ASR 相同的北京千问 Omni 模型和端点：

- `qwen3.8-omni-flash`
- `https://cn-beijing.maas.qianwenaiapi.com/compatible-mode/v1/chat/completions`
- WAV data URI；`stream: true`、`modalities: ['text']`、`reasoning_effort: 'none'`、`max_tokens <= 1500`

不读 `.env`、个人密钥或全局配置。专用项目语音凭证只通过宿主 `deps.voiceKey` 注入，不能进入 renderer、模型输入、日志或结果。启用开关、明确 `allowLive`、授权过期时间、宿主 context deadline 与调用预算必须同时有效。构造适配器不会联网；只有 `assess` 在通过本地检查后才可能发送请求。

输入只接受本地字节和原始转写文本，不接受路径、任意 URL 或模型指定的凭证。按现有 `inspectWav` 严格验证 16 kHz、单声道 PCM16 WAV、4 MiB / 120 秒上限。复制调用方可变音频并快照原文，避免等待期间被修改。

调用示意（仅展示宿主集成，不是已接通的产品入口）：

```ts
const assessor = createExpressionAssessor(config, {
  context: trustedHostContext,
  voiceKey: dedicatedProjectVoiceKey,
  beforeDispatch(event) { sessionBudget.reserveExpression(event); },
  onResponse(event) { sessionBudget.recordExpressionResponse(event); },
  onUnknown(event) { sessionBudget.retainUnknownExpressionHold(event); },
});
const estimate = await assessor.assess({ wavBytes, originalText }, signal);
// 独立保存候选估计供人工核验；不得合并进正式综合分。
```

上面的 sessionBudget 方法名是宿主集成示意，不代表仓库存在这些具体方法。实际应适配当前 session ledger 接口。三个 hook 都必须是关键同步持久化操作；异常或返回 thenable 会 fail closed，不能 fire-and-forget。hook 事件只有 callId、音频 hash/时长、modelId、输出上限、deadline、声明的预留成本，以及响应时的 HTTP 状态/可用 usage，不包含音频、转写或密钥。

## 本地弃评与保守记账

沿用现有 RMS 活动描述：时长至少 3 秒、活动能量至少 1 秒、转写至少 4 个现有计数单位，且计数脚本受支持，才允许请求候选表达估计。静音、短音频、空/不足转写直接 `insufficient_data`，三个维度均 null，**不联网、不消耗模型调用额度**。RMS 不是语义语音检测，恒定噪音也可能满足活动门槛，因此通过门槛不等于存在足够真实语音证据。

模型对所有维度弃评时，同样返回 `insufficient_data`。无效分数、空证据、越界时间、伪造逐字引语、额外字段、截断 SSE 或非法 JSON 直接失败，不能包装为成功结果。固定使用完整 SSE 解析器 `parseOmniTranscript`，等 `[DONE]` 与 stop 到齐后才解析 JSON。

适配器内部按声明的 maxCalls、总音频时长和成本预留设置上限，不将声明预留当作供应商实际账单。`beforeDispatch` 可供宿主挂接跨功能、跨重启的正式 session ledger；独立适配器自身只提供内存级本地门槛，不能冒充持久预算。

无自动重试。取消/超时同时中止网络与取消读取；即使 fetch 或 reader 忽略 signal，也通过 Promise race 拒绝且不发布迟到结果。响应上限 256 KiB；重定向禁止。发出请求后无法获得完整响应时触发 `onUnknown`，保留成本占用并阻断该实例后续调用。完整响应但无 usage 时不捏造零 token 或零费用，宿主仍须保守保留成本。HTTP 拒绝也通过 `onResponse` 记状态，不能静默退款。

## 离线验证

运行 `bun test tests/expression-assessment.test.ts`。测试覆盖固定网络载荷、未验证标签、逐字证据与时间区间、静音/短音频/空文本弃评、严格配置/预算/取消、忽略取消的迟到响应、停滞 reader、响应超限、异步 hook fail closed 与截断 SSE。

测试注入确定性 SSE 与合成 WAV，没有真实联网、模型识别或真人标注；通过测试只验证协议、校验、生命周期和计费挂接机制。

## 试点接线与受限在线结果

当前可选assessment已接入语音任务，ASR完成后独立分析；失败保存expressionError并保留原转写，不使技术答案失效。默认试点离线，live模式显式启用，beforeDispatch接统一会话ledger，时间与费用受限。2026-11-06合成英文在线样本曾返回超出4.22秒的证据区间，按契约拒绝；后一次合法输出通过结构/区间校验，仍为unvalidated-model-estimate、reliabilityValidated=false、usedInFormalScore=false。不能将后一次通过解释为可靠性改善或真实情绪识别。
