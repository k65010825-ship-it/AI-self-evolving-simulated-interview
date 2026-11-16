# 结构化输出失败诊断

评分输出仍依次经过生成完成检查、JSON解析、schema、原文引用定位和领域核验。诊断只解释拒绝，不绕过任何门控，不自动补括号、改引用或提高分数。

## JSON结构摘要

`EvaluationDiagnosticSchema.jsonShape`仅包含六个枚举字段：scope、root、containers、stringState、openDepth、trailing。扫描器识别字符串和转义，避免将字符串里的括号当容器；深度只记录zero/one/two-plus/unknown。完整单JSON围栏可在显式策略允许时局部解包。

结构摘要不是语法认证：容器balanced仍可能有尾逗号、非法转义或其他语法错误。原有jsonIssue保留，只有真正JSON解析与后续校验通过才能继续。摘要不包含原文、键名、坐标、文本长度或解析器错误消息。

## 引用重叠

`bindingConflict`包含固定字段对和关系identical/contains/contained-by/partial-overlap。过程层按action、target、expectation顺序报告首个冲突；观察层仅检查metric与value。只有已有重叠拒绝分支才生成该字段。

过程层相邻片段允许；观察层片段嵌套于expectation允许；condition复用action允许；宿主定义的命名谓词包含metric仍按原例外处理。不能将过程层互斥规则泛化到所有片段。原bindingIssue与无分数拒绝行为不变。

## SDK与持久化

Pi适配器在有界输出上生成摘要，受限修复包装器保留诊断；宿主评分工具追加冲突关系。批次JSON、Markdown和SQLite回放使用同一契约，不保留失败输出全文。旧记录没有新字段仍可读取，不回填推测信息。

quoted-spans/v2提示增加`quoted-spans-v2-structural-guidance-1`指导版本，明确JSON闭合/转义及两层片段不同边界；业务输出版本不变。提示到达真实SDK已离线验证，供应商遵循情况尚未验证。

## 验证与使用

### 上游到SDK的流式完成取证

`transport/observed/wire-completion-observed`仅记录`WireCompletionSchema`固定字段：doneSeen、finish、framing、textMatch、sdkStop、comparisonScope。上游`finish_reason`映射为固定类别，不保存供应商原始字符串；正文只在内存中以UTF-16码元增量摘要比较，摘要也不输出或持久化。它不是JSON/schema通过事件，观察器异常不能改变结果或计费。

CR本身结束SSE行，紧接的LF只吞掉一次，不能等下一块LF到达后才分发空行。当SDK在`[DONE]`处停止读取时，计量器必须已经识别终止标记。缺DONE或usage不可信仍保留unknown，不因本次修复自动清旧账。回归以SDK提前停止读取的拆分CRLF重现旧计量缺陷。

| 取证结果 | 能说明什么 |
| --- | --- |
| DONE、stop、正文matched，但JSON未闭合 | 主机接收的上游正文在SDK阶段未改变；不能追溯供应商内部或到达主机前的代理链路 |
| 正文mismatched | 两个本地边界不一致，需排查适配/解析；不能靠补括号或加token解释 |
| 缺DONE/finish或framing invalid | 完成证据不足；unavailable不等于已证实丢包 |
| length | 上游声明长度结束，是否恢复仍受原预算/期限/策略约束 |
| host-continuation-not-compared | SDK收到的是宿主合成前缀＋续文，不与末次上游后缀直接比较；textMatch必须unavailable |

评分可由宿主显式配置`evaluationResponseFormat: "json_object"`，通过已安装Pi公开`onPayload`设置`response_format:{type:"json_object"}`及`enable_thinking:false`。只约束评分请求，规划工具循环和承接语保持原格式。缺省或`text`维持历史行为；可选字段不填默认值，避免历史冻结摘要漂移。不采用未经核验的JSON Schema子集，也不把工具参数约束当成最终回答约束。

请求发出前复核格式、禁用评分工具参数。评分和通用后端隔离但共用预算gate，调用ID分命名空间。`json-mode-requested`只说明宿主请求意图；HTTP400记录`json-mode-http-rejected`并保守保留费用占用，不证明具体是参数不支持。批次停止余题、保留not_run分母，不重试或降级text。其他不明网络结果沿用unknown阻断。

依据[千问结构化输出文档](https://platform.qianwenai.com/docs/developer-guides/text-generation/structured-output)，JSON模式改善语法生成，但本项目仍保留预算硬上限`max_tokens`，不能保证不截断。JSON模式禁止片段续写，可显式采用有预算的完整重生成；当前验收配置不启用任何重试或重生成。JSON、schema、引文、验证目标绑定和分数均继续独立校验，合法JSON不代表评分正确。旧批次不回填诊断；真实供应商效果须新批授权后验证。

运行`bun run agent:diagnostics:demo`生成8类合成JSON与两岗6类绑定结果，真实模型调用为0。专项测试覆盖SDK修复包装、零分接受、原输入不变、持久回放和合法例外。

历史run-A0Ghpo未保留失败原文，不能重建具体缺失字符或冲突字段。新诊断只适用于后续运行；新提示的真实效果须另建冻结批次并明确授权预算，不能复用历史额度或把离线回归称为双岗质量通过。

quoted-spans生成契约使用`quoted-spans-v2-rubric-disclosure-guidance-4`：从共享wire Zod schema按每个宿主criterionId展开闭合的numeric/null结构，减少模型合并深层if/then规则的负担。numeric分支固定最大分、goal身份及允许的binding；有observationPolicy才要求observation，无目标禁止binding；null分支禁止binding且evidenceIds为空。根feedback始终必填，评分项只容纳criterionId/score/evidenceIds及允许的verificationBinding。提示前置拓扑与尾部检查明确feedback属于根对象，不能放进评分项或绑定。它仍是提示层JSON Schema，不宣称供应商强制schema采样；超过输入预算直接拒绝，不截掉规则。

同类“评分项带未知键＋缺少根feedback”用人工构造的机制反例复现拒绝，不能据此重建历史未知字段名或位置。宿主未增加删键、迁移feedback或补造反馈的修复，评分、引用和澄清规则不变；真实改善仍以新冻结批次为准。

生成指令由宿主量规渐进披露：所有题加载通用评分、原文引文和根feedback规则；至少一个criterion有verificationGoal才加载绑定身份、action/target/expectation与不重叠规则；至少一个goal有observationPolicy才加载metric/value/condition、局部句子及predicateAlias规则。普通题只显式禁止verificationBinding，不展示构造字段或验证示例。混合量规仍按每项schema约束允许范围，回答关键词不能启用模块；构造器无跨调用状态，不复用上一题的规则。该分层减少无关说明，是否减少真实绑定违约仍须新批次验证。

## 宿主验证候选（可选candidate-refs协议）

`verificationExtraction: "candidate-refs"`仅可与quoted-spans组合；缺省沿用verbatim-quotes，不为历史配置注入字段。新质量批次显式启用；现有本地profile不自动迁移或更改默认配置。共享评分器支持该配置，不等于桌面/stdio真实链路已验收。

宿主按原始回答、题目和不可变量规生成候选ID，绑定criterion/part/UTF-16位置。动作/对象/条件/指标使用字面别名，预期使用含指标的局部子句，数值使用受限紧邻语法或宿主谓词别名。重复原文有不同ID及邻近上下文；不会用第一次匹配代替选定位置。每部位最多16、总128候选，超限在HTTP前失败，不静默裁剪。倍率、千分位和不支持的限定百分比不会截前缀；保守留空，缺少必需部位时提示schema只允许该维null。别名、句式和数值格式覆盖有限，不承诺自动理解任意表述。

候选catalog放入user数据，系统提示仅含协议与可选ID，不把学生摘录升级为系统指令。模型返回严格`verificationSelection`（mode及action/target/expectation的ID，有policy才加metric/value/condition的ID），目标项evidenceIds为空；不得返回raw verificationBinding或坐标。宿主只按显式有效选择装配原文证据及goal身份，随后执行原绑定/观测和评分校验；不自动选候选、改值、填分或写正式状态。null不装配证据，普通项不得选择，旧raw绑定不会自动转为新协议。

固定诊断`candidate-selection-invalid`附candidateIssue区分缺选择、无目标/空分带选择、外来或错部位ID、观测策略不符、跨句、绑定守卫、证据命名冲突等；不输出ID、原文或未知字段名。英文句点与中文句界统一检查，小数点保留。否定只继承既有紧邻短语守卫，不能声称任意否定或跨实验语义都能被识别。候选来源真实、选择有效和binding bound，均不是答案正确或执行过实验的证明。
