# 双岗评分质量验收

覆盖Java后端、Web前端的正常回答、证据不足/澄清、明确不会/弃评与验证目标题。使用与本地Agent相同的Pi评分器、量规、引文定位和澄清核心，固定题目、不调用规划模型。评测专用SQLite与报告写入`.cache/scoring-quality`，不提交用户会话或记忆，不是桌面/stdio联调替代品。

## 样例与参考边界

每岗四例，共八例。普通题使用现有岗位知识；验证题复用带版本的observation验证目标草案，不修改正式知识或批准状态。

| 类型 | 草案预期 | 观察点 |
|---|---|---|
| 正常回答 | scored；各维度归一化0.75—1 | 回答机制/边界、分数区间、原文引文 |
| 模糊不足 | needs_clarification；各维度未知 | 无证据不得编造引文或当0分 |
| 明确不会 | abstained / clarification_limit；零模型HTTP | 澄清额度0，本地非回答守卫，不能给分 |
| 验证目标题 | scored；各维度归一化0.5—1 | 同一局部证据中的条件/动作/对象/预期、goalId/version |

问题、量规与答案进入模型；类型、预期、分数区间、解释只留在验收侧。全部样例/参考是AI制作的development草案，人工参考0、`qualityClaimEligible=false`。区间是可审阅的验收假设，不能宣称专家一致性、学生能力或教学效果；不把失败后改标签当成模型变好。标签与源码变化都要重新冻结批次。

## 判定与报告

报告保留全部八例，分别展示运行完成、预期行为匹配、草案分数区间、引文和绑定字面检查。运行失败/未执行留在八例分母中，不算弃评。null不转0：一个格式合法但明显错误的0分可以通过运行检查，同时使参考区间检查失败。区间比例分母只用实际有分的参考维度，另显示预期配对数；没有配对时比例为null。

`passed-draft-checks`要求八例运行和行为均符合预期、所有预期分数维度完成且落入区间、引文/绑定字面检查通过。它表示草案一致，语义质量仍待独立审核；有引文不证明引文支持所给分数，绑定也不证明实际执行。失败不隐去、不用重试取最好成绩。

报告JSON包含逐例snapshot、固定分类诊断、预算记录与派生指标，Markdown给出可阅读矩阵。inspect重算指标和预算投影，校验摘要与绑定；SHA256只检查一致性，不认证推理来源，不能防恶意本地操作者替换整套证据。

## 执行与额度

```powershell
bun --no-env-file run agent:scoring:quality prepare
bun --no-env-file run agent:scoring:quality demo
bun --no-env-file run agent:scoring:quality inspect <批次目录>
```

prepare冻结八个输入/参考、完整配置和源码摘要，生成review.md与禁用授权模板，不读Key、不联网。demo用真实Pi和合成HTTP走同一评分链，标记injected-http；固定响应只验证工程机制，不证明模型语义能力。inspect只读既有报告，不创建运行时、取Key或重发调用；可观察旧冻结数据，不授予新的执行资格。

真实批次使用千问AI平台qwen3.8-max，端点`https://maas.qianwenaiapi.com/compatible-mode/v1`，仅引用项目`INTERVIEW_QIANWEN_API_KEY`，声明来源为千问AI平台。八例最多六次HTTP（两个明确不会样例零调用），总人民币2元声明费率预算；单次30秒、最多输出4000 tokens，一例最多一次HTTP，禁网络重试、模型修复和额外规划。费用不等于厂商账单。

在操作者审阅并明确批准该批供应商/凭证来源/额度后，填写同目录authorization.json，绑定batchId/digest与有效期，再执行：

```powershell
bun --no-env-file run agent:scoring:quality execute <批次目录> --authorization <批次目录>/authorization.json --execute
```

CLI不自动读取.env或全局Pi配置；项目主进程可通过按需resolver提供凭证。门控通过后先wx创建一次性execution，再独占创建评测状态目录；失败也不重置claim或续用剩余额度。协议/评分拒绝作为该例失败保留，后续独立样例仍在固定额度内运行；unknown或账本锁定停止后续请求，保留未运行例和额度，不以新批次隐藏旧unknown。

共享契约见[scoring-quality-schemas.json](scoring-quality-schemas.json)。正式质量结论需更大样本、独立标注与对照；本模块不自动发布策略或修改评分权重。

## 缺证据、0分与澄清

所有Pi评分模式共享`evidence-decision-v1`：先逐维判断是否存在与题目相关、可评估的断言，再应用分数锚点。只有经验宣称、做事意愿、泛化流程或复述问题，不足以推断技术正确性，应为`score:null/evidenceIds:[]`。有明确、相关且错误的技术断言时，才可引用其原文给0分；部分正确的有效解释仍可正分，不能因一句“不清楚”而抹掉全部证据。这是统一生成规范，宿主的字面检查不能独立证明语义分类正确。

评分模型仅输出evidence、criterionScores、feedback三个顶层字段；缺证据通过各维度null表达，完整格式例子由当前宿主量规生成。模型不返回status/reason/clarification等工作流顶层字段。未知键继续严格拒绝，不通过删键、转换0分或重新生成放行。该规范改善的是生成契约，不能追认旧Java失败的额外键名称。

完整模型输入必须先通过ScoringModelInputSchema，再生成量规格示例或引用schema；非法题目/量规统一抛VALIDATION_ERROR，不能让格式生成器的Zod错误泄漏未知字段。该拒绝发生于供应商调用前。

宿主保持既有澄清状态机：缺证据且有时间/额度时给固定中性提示；补充只追加原回答，仍无证据则按次数或时间终止弃评，保持null。补充后有证据的0分和正分均可正常记入一次能力观察；未解决前不写分数。`tests/insufficient-clarification-regression.test.ts`验证两岗这些分支和严格拒绝模型工作流信封；注入测试不证明模型实际理解了语义。

独立运行的对照批次使用新措辞，覆盖正确、模糊不足、明确不会、明确错误断言，每岗四例；原baseline八例及参考不改，baseline继续覆盖验证目标题。对照集仍是AI制作的development样例，不是盲测金标准或统计独立的人类参考。

```powershell
bun --no-env-file run agent:scoring:quality prepare --suite contrast
bun --no-env-file run agent:scoring:quality demo --suite contrast
```

每个批次仍各自最多6HTTP/2元声明预算，独立claim、独立授权，不自动续用旧额度。新对照集的incorrect类型预期为有证据的scored零分，正常题仍须正分，从而检查澄清策略没有过度弃评。真实复测须按已冻结的具体批次重新授权；两批顺序执行时，第一批出现unknown必须停下，不启动第二批。

新准备批次显式启用`evaluationResponseFormat: "json_object"`，仅评分请求使用供应商JSON-object模式；输出4000 tokens硬上限及本地全部严格校验不变。HTTP400停止剩余样例并保留未运行分母和保守费用占用，不自动换参数重试。历史缺省配置仍可只读验算，旧失败与标签不修改。配置请求成功、协议通过与独立评分质量通过须分别报告。

复杂验证题的提示层schema按评分项展开numeric/null闭合结构，并明确根feedback层级；没有新增模型调用或本地字段修复。`tests/verification-output-contract.test.ts`覆盖同类字段错位拒绝、真实Pi提示送达、混合量规与超大规则预算拒绝。反例是机制夹具，不能当作未保存的历史原始响应。通过这些测试仅证明生成契约与拒绝边界，需独立授权新批次验证供应商真实表现。

`tests/rubric-protocol-disclosure.test.ts`验证普通题、仅验证目标、含观测策略三种指令范围，普通题回答即使包含验证字段关键词也不触发加载。宿主schema继续拒绝非法绑定，不能用本地剥离绑定或自动弃评让样例通过；历史批次及AI标签保持原样。

## 难例与重复运行稳定性

`challenge`是新AI development草案，不是独立专家标签或统计意义上的留出金标准。每岗四例：部分正确（仍应有部分正分）、混合正误（逐维正分/0分并存）、错误验证结论（完整引文绑定且相关错误得0分）、已支持的明确不会短句（宿主零调用弃评控制）。与baseline/contrast分开冻结，不改变旧题答、标签或报告。难例量规是评测专用draft，不自动发布为正式岗位知识。

每批8例仍最多6HTTP/2元声明预算；部分正确及混合样例为普通评分协议，只有验证样例携带verificationGoal。问题、答案与量规进入模型；参考区间和理由不进入。合成fixture只验证结构、计量和拒绝机制，不是语义裁判。

```powershell
bun --no-env-file run agent:scoring:quality prepare --suite challenge
bun --no-env-file run agent:scoring:quality demo --suite challenge
# 两个批次均已执行且报告存在后，只读比较，无凭证或网络调用
bun --no-env-file run agent:scoring:quality compare <first-batch-dir> <second-batch-dir>
```

新challenge批次冻结`stabilityPolicy={version:1,runs:2,maxNormalizedDrift:0.25}`，缺省不为旧批注入字段。真实两批须分别冻结并明确授权；比较命令不代为执行、不自动补跑。它先只读验算两份历史报告，再要求不同批次及报告摘要、同为challenge、相同题答/参考/源码/配置/策略及运行模式；不能混用真实与注入HTTP报告。

比较输出带摘要的JSON到stdout；符合开发规则退出0，不符合退出1，参数或证据拒绝退出2。逐例统计行为一致（失败/未运行不能算一致），逐维按归一化分数计算绝对差、均值和最大值；缺失配对保留在8个预期评分维度中。只有两批草案验收都通过、8/8行为一致、全部维度配对且最大分差≤0.25，`draftStabilityPassed`才为true。0.25是本项目固定的开发阈值，不是科学可靠性门槛；两次重复不支持置信区间或长期稳定性结论。比较本身不新增模型调用，不修改标签、账单或策略，也不取得独立人工质量资格。

新准备批次显式启用`verificationExtraction: "candidate-refs"`。验证题使用宿主原文候选和模型ID选择，见[候选协议](output-diagnostics.md)；普通题仍用严格原文引文。新协议没有额外模型调用；输入/标签不改，旧quoted失败不转换为成功或弃评。旧报告仍可inspect，新旧配置不相同则compare拒绝，不能把不同协议前后结果当同配置重复稳定性。新两批的题答、源码、配置、阈值须分别保持相同。
