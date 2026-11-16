# 岗位题型与多维内容量规

## 双岗位结构化评分与澄清批次

`bun run agent:quality:batch prepare` 冻结 Java 后端、Web 前端各一条 v3 候选题、量规、verification goal、原答与追加答，以及当前源码清单。产物在新的 `.cache/quality-batch/run-*`：`review.md` 为完整待复核样例，`batch.json` 为摘要绑定材料，`config.example.json` 默认关闭授权。prepare 不读取凭证、不派发请求；修改源码后必须重新准备批次，不能只重算摘要沿用旧结果。

每岗最多三次单轮评估：错误陈述控制、验证条件归属不明确、收到定向澄清后追加补充。补充只追加原答；前一步未产生澄清则跳过第三次，不强行制造闭合。两岗材料、量规及复核提示均为 AI 草案 development，提示不输入模型，独立人工参考为0，不参与评分准确率或学生提升率统计。

完成本批次明确授权后，复制模板为本批次配置，设置 `authorization.enabled`、`operatorApproved` 为 true 和短期 `expiresAt`（毫秒时间戳）。执行前在候选配置明确evidenceGrounding及outputRepair（none或json-fence-only），其余预算/恢复限制保持原样；这些选择同样进入首次执行配置摘要，不能执行后修改。凭证仅由服务端的 `INTERVIEW_QIANWEN_API_KEY` 提供，不填写在配置 JSON 或报告中。显式执行：

```powershell
bun run agent:quality:batch --batch <批次目录> --config <已授权配置路径> --execute
```

固定千问 AI 平台 `qwen3.8-max` 与模板端点，最多6次 HTTP；每次最多12000输入/4000输出 tokens、30秒，禁止自动重试、模型再次生成、截断恢复、上下文压缩及额外规划/播报调用。outputRepair默认none，可显式启用本地单层完整JSON围栏解包；不增加HTTP尝试，不代表允许maxModelRepairs。声明费率预算人民币2元；按模板费率计算六次最坏预留为1.728元。费率未经供应商核验，因此这不是供应商实付上限保证或账单对账结果。

首次执行固定配置摘要和开始时间，每条请求固定 ID/载荷/期限，SQLite 持久任务、事件和用量。重复执行只重放已有终态；同批次更改配置（包括延期）被拒绝，授权过期后不执行。网络消耗 unknown/dispatched/locked 时保留预留并停止后续派发，不新建任务绕过。此库只管本批次，既有账本及 unknown 不被清除，也不证明全项目预算已对清。

`report.json` 保存逐例状态、候选评分、原文引用与分母、已结/保留 token 和声明费用；`report.md` 便于人工逐例核对。每例静态阶段诊断写入绑定请求摘要的 `*.diagnostics.json`，重放后仍保留 JSON/schema/引用/算分等拒绝原因。schema拒绝最多投影4组固定字段类别、错误类别和接收类型（例如某字段为null、缺失或类型不符）；不记录模型自定义键、值、Zod原始path/message或供应商错误。相同诊断贯穿有预算的修复包装层，不因包装丢失。历史或崩溃前未采集的诊断明确标为缺失，不能从通用 MODEL_OUTPUT_INVALID 反推根因。

失败按实际失败保留，不自动修正标签或补跑。结构与引用范围通过仍需独立核对技术判断、引用支持度、澄清准确性和是否泄题；固定 `qualityClaimEligible=false`、`vendorBillingVerified=false`。缓存含合成原答与 SQLite，应作为本地验收资料管理。工具会拒绝源码漂移批次；修复代码后新建批次，不修改旧失败报告或套用旧结果。

专项 `bun --no-env-file test tests/quality-batch.test.ts` 使用真实 Pi SDK、注入 HTTP 与合成 usage 验证六次链路、幂等重放、配置冲突、材料篡改拒绝、unknown 停止与脱敏诊断持久重放；不调用真实供应商。

## 当前实现

### 验证子片段由宿主定位（离线验证）

显式配置 `evidenceGrounding: quoted-spans` 启用独立模型协议。当前提示为quoted-spans/v2，兼容v1裸引文：外层证据提供 `{id, excerpt}`，action/target/expectation及observation.metric/value/condition提供 `{evidenceId, excerpt}`；两层均可额外提供 `context:{before,after}`。每侧最多120个UTF-16单位，缺省侧按空串处理，但至少一侧非空。完整内部schema见 `apps/agent/src/evaluation/quoted-spans.ts`，按需提示见 `harness/skills/evaluation-quotes.ts`；不同时注入旧坐标schema，默认配置和两个旧模式不变。

宿主先在原答中定位外层引文，再在该维度已引用的同一证据单元中定位子片段。重复时只用紧邻引文的精确before/after筛选，提供了错误锚点的唯一引文也拒绝，子锚点不得借单元外文字；筛选后必须唯一，不选择第一个匹配，不接受模型数字猜位。成功后派生JS UTF-16 `[start,end)`，进入原严格业务schema、Stop门控、量规算分与验证绑定检查。业务结果/API/持久候选仍只含原数字坐标，context不会进入业务绑定；目标/version、mode、分数、引用ID和反馈不被替换。不存在、无锚点歧义、锚点后仍多解、未引用及跨单元明确拒绝；不做模糊匹配，不混用旧坐标与引文格式。坐标正确不认证技术正确性、条件归属或实际执行，别名、范围、重叠与局部观测策略继续检查。

领域评分在原有 `invalid-score` 前增加固定原因，例如 `score-out-of-range`、`score-evidence-unknown`、`score-null-binding`、`score-binding-invalid`、`score-dimension-set-mismatch`。`score-binding-invalid`另带固定bindingIssue，区分目标ID/版本、证据单元、片段范围/重叠和观测范围等既有规则；原status/reason及工具错误回执不改。引文定位错误另带quoteIssue，只含引用部位和none/one/multiple。schema通过后即使定位失败，也明确发布schema/accepted。详情经修复包装、批次JSON/Markdown及重放保留，不包含原文、维度ID、模型值或坐标；观察者失败不改变结果。新详情不用于反推未记录这些字段的旧线上失败，也不认证完整语义。

离线专项：`bun --no-env-file test tests/quoted-spans.test.ts tests/scoring-rejection.test.ts tests/quoted-runtime.test.ts`。两岗合成夹具覆盖观测片段、Unicode、有效零分、歧义/跨句/跨证据/重叠拒绝，真实Pi会话、注入HTTP/合成usage、SQLite关闭重开幂等重放和取消。注入故障不能触发JSON模型修复或第二次HTTP；无真实供应商调用、真人或独立质量审核。配置继承例子中的pi-knowledge会额外运行规划，因此评分专项显式使用deterministic规划，不据此宣称自然规划质量已验证。

Pi模型输出先经过窄范围协议规范化：只把宿主量规中不需要绑定、或分数已为null的已知维度的 `verificationBinding:null` 转成字段缺省，并记录 `schema/repaired/optional-binding-omitted`。不改数值、引用、feedback或原对象；未知criterion、仍需绑定的数值评分、未知字段和错误值继续拒绝。业务 `EvaluationOutputSchema`、Stop门控和验证绑定检查保持严格；这一步不是第二次模型调用，也不消费模型修复次数。提示词明确省略非适用字段，span只允许evidenceId/start/end。

模型偏移不可靠时，可显式配置 `evidenceGrounding: unique-excerpt`：宿主只对原文中唯一出现的精确引文派生UTF-16位置，不做模糊匹配、不补写引文，也不猜测验证绑定中的子片段；子片段仍按原有宿主规则检查。引用合法仍不证明技术评分正确。该配置与实际模型结果应在批次报告中一起记录，不能与model-offsets模式的结果混称同一次验收。

两岗各四种题型：technical、scenario、project、behavioral。选题已开放行为题，继续遵循累计能力状态、会话固定策略、岗位/技能/已问题/难度/审核约束。项目和行为题新增四个维度、原文证据规则及0—4分锚点，版本seed-0.2，仍是draft，不代表专家审核或真实模型质量验证。原技术/场景量规仍兼容。

`bun run agent:rubrics:demo` 使用真实Pi SDK与本地provider，每岗按累计状态完成项目题→行为题→报告。固定手工分数仅验证schema、工具算术和流程；不证明摘录支持维度判分、不证明真实经历，也不证明逻辑/沟通评价可靠。实际模型与真人参考评测待后续授权与数据准备。

## 岗位差异与维度

| 岗位/题型 | 维度ID及权重 | 专属考察 |
| --- | --- | --- |
| Java项目 | invariant .40、ownership .20、logic .20、verification .20 | 容量不变量、事务/并发边界、个人修改、失败与并发验证 |
| Web项目 | measurement .40、ownership .20、logic .20、verification .20 | 渲染测量、组件状态边界、优化代价、交互回归 |
| Java行为 | impact_triage .35、communication .30、logic .20、verification .15 | 故障影响/止损、分工同步、因果叙述、修复核对 |
| Web行为 | user_scenario .30、negotiation .35、logic .20、ux_verification .15 | 用户场景/接口冲突、可执行协商、取舍、交互验收 |

dimension用于显示/解释，当前允许correctness/depth/ownership/logic/communication/relevance/verification。不同量规中同名logic不是独立校准、可直接平均的全场逻辑分。当前只给逐题固定权重结果，报告仍不提供跨题总分；能力估计仍为原启发式，不是心理或就业测评。

## 契约与证据

现有报告已补逐量规反馈：报告重放算分/原文偏移后，为每个criterion生成criterionFeedback卡片，绑定answerId/questionId/rubricId/version/criterionId和evidenceIds。引文只保存在assessment.evidence一次，按同assessment的ID解析；不在每条建议里复制全文。requirement/evidenceRule来自当前量规，nextAnchor为严格高于记录分数的第一档；无锚点时为null，满分只建议换题验证迁移。

卡片状态scored_gap/scored_strength/not_scored描述记录分数，不证明摘录支持这个分数。priority=criterion.weight×(1-normalizedScore)只用于同技能学习动作排序；未评分不当零分。semanticSupport恒为not_verified，模型原feedback保留并标feedbackVerification=not_verified。报告不会依据截取字符串就断言回答缺少某一技术事实，也不将低分推成心理/就业能力诊断。

studyPlan.actions改为最多3条基于分数/量规的确定性练习目标，feedbackRefs按answerId+criterionId绑定，evidenceAnswerIds只包含这些动作实际引用的当前回答。只有历史或未知技能时使用无引用的通用补测动作，不虚构当前引文；retest.excludeQuestionIds同时保留同技能历史与本场题。模型自由improvements不再直接成为学习任务；它仍可供人工检查。

ContentReportSchema校验卡片的分数/量规/证据引用及学习动作交叉引用一致性；结构一致不认证原数据或语义。完整原文/算术重验只发生在buildInterviewReport，API正式接纳仍需可信原始记录、归属和版本/fence。卡片/refs为增量可选字段，旧纯结构报告可缺省读取；旧持久候选/精确报告比较不能假定自动迁移，应从可信原输入按当前规则重建。当前没有正式数据库迁移或新HTTP接口。

确定性卡片投影放在packages/interview-domain/src/feedback.ts，Agent报告与后端客户端提交校验共用，不让后端导入Agent/SDK实现。客户端从可信原轮次重建期望卡片后继续精确比较；一起改卡片action与学习动作虽能满足引用一致性，仍不能通过提交准入。不代表客户端重跑整个报告算法或验证教学语义。

`bun run agent:rubrics:demo`现在还输出逐回答卡片/缺口数量；完整卡片可通过runContentRubricsDemo的report读取。仍为真实Pi SDK+手工本地分数，没有新增真实模型调用、人工核验或效果证明。

公共schema：rubric-dimensions.ts、tools.ts、scoring.ts、report.ts。KnowledgeItem.rubric与Rubric.criteria新增可选dimension、evidenceRule、anchors，旧量规可不提供；选题时完整透传给宿主评估量规。机器定义随openapi:generate生成；runtime内部turn/report继续直接使用共享schema，不新增路由。

anchors为{score,description}有序数组，至少2项、最多10项，必须从0到maxScore、严格递增且不越界；本轮种子均为0/1/2/3/4。项目种子锚点针对具体容量/渲染问题，行为种子针对具体故障/协商问题。锚点是评分描述，不是模型训练完成或人工一致性证明。

模型输出只允许criterionScores与原文证据等既有字段，不能修改权重、维度定义或锚点。宿主复验UTF-16摘录与答案一致，并按固定权重计算；这不证明引用语义足以支持分数。缺证据保持null，不能凭空补0；目前必需维度不全会拒绝单轮候选（MODEL_OUTPUT_INVALID），不是自动给满分或部分报告。明确0分也须真实引用相关错误/空泛表述。

行为回答只评价叙述中的动作、逻辑与协作方案，不推断人格、真实心理、诚信或经历真实性。允许明确标记假设案例，不因没有实习/事故经历而要求编造。此为提示与量规要求，真实模型是否遵循仍需参考集测试。

## 范围、状态与记忆

technical/project/scenario对应technical-content，behavioral对应behavioral-content。evaluateTurn在模型前校验题型与rubric.scope一致；报告重放同样校验。项目题可以考察方案论证与表达逻辑，但不因此变成心理评分。

同role/skill的掌握度估计不得混合行为构念与技术构念。InterviewStateSchema校验全部priorEvidence+observations，MemorySnapshotSchema校验全部历史场次；冲突拒绝VALIDATION_ERROR。选题过滤与该技能既有构念冲突的候选，无可用题则unavailable，不切换技能伪装成功。协作技能与技术技能应分别配置，例如collaboration和project-design，仍由状态规划器决定先考什么。

已有旧快照若混合两类证据将被拒绝，需后端/资料维护者审核后分拆技能并保留原始版本，不能自动改旧题型或把历史行为分当技术分。首次没有观测的技能，按现有难度/ID规则选择；本模块不保证四类题在每场面试都出现。宿主须配置相应技能与知识，不能拿示例双轮覆盖当所有会话的覆盖保证。

## 报告与校准边界

report.scope可为technical-content、behavioral-content、mixed-content，来源是本场量规与所有参与画像的历史题型；即使本场无回答，行为历史也不能丢失范围警告。assessments新增questionType（读取旧报告可缺省），每条保留量规版本、维度元数据、权重、得分和证据，不同量规不直接合并。

行为范围附behavioral_narrative_not_verified_experience，当前多维元数据附dimension_ratings_not_independently_calibrated；语音原有audio_descriptions与独立ASR来源保持不变。内容范围与语音质量是不同维度。

RSI/复测数据仍按岗位/技能/量规版本等分组；不得把新seed-0.2分数与seed-0.1合池，或把collaboration行为分混入技术技能曲线。旧模型分、合成样例与人工参考分别标记。尚未开展真人维度一致性、跨量规等值或实际教学效果实验。

## 缺证据与负向支持校验（2026-11-07）

当前评分在引用位置/ID/范围与算分之外，共用 `packages/interview-domain/src/evidence-support.ts` 的有界负向规则：

- 完整回答仅为明确无实质作答（如“不知道”、I do not know）时，完成身份/岗位/版本/语音源/取消和时限校验后，在模型派发前进入既有澄清/弃评；不开新模型请求，不写能力观测。不是将其中出现“不知道”的长回答全部丢弃，也不将“不会”或单个符号一律判空。
- 数值评分引用的全是无实质作答文本时，不能给0分或正分。允许弃评的调用将该维改null并清除评分引用；严格评分/报告重放拒绝该结果。实质性错误陈述仍可有依据地打0。
- 明确标为verification的维度，如果所引仅含已知风险/建议/埋点线索且未说明任何检查/验证动作或可观察预期，则保留未知；ownership维度的泛化建议没有本人动作或明确假设角色时同样不补分。假设性的验证方案无需伪装成已经执行。

这是少量可解释反例规则，不是通用语义蕴含器。规则使用文本线索，存在未覆盖表达和误判可能；没有dimension元数据时不猜测维度。出现“测试/验证”词语也不证明引用足以支持具体分值。不命中规则只表示未发现这些反例，报告的semanticSupport仍为not_verified。AI辅助标签和离线回归不变成人工金标准。

算分executor、报告重算和候选提交校验共用规则。提交时也重查已有turn，避免把不安全旧候选直接restore成当前状态；原始历史记录不删除、不改分，旧不安全候选需要复核，不能静默迁移。部分维度有依据时可留局部观察分，但完整workflow不会把不完整评分变成0分或掌握度观测。

新增静态诊断：no-substantive-answer、risk-only-verification、advice-only-ownership，不包含回答原文。Pi评分提示同时区分“缺证据”和“明确错误”，不自动追加语义判别模型调用。运行 `bun test tests/evidence-support.test.ts tests/evidence-support-boundaries.test.ts`。

## 引用支持开发回归矩阵（2026-11-07）

`bun run agent:answers:evidence` 运行 `evals/answers/evidence-support`，报告写入新的 `.cache/evidence-support-matrix/run-*/report.json`，不覆盖旧报告，不读取凭证或派发供应商请求。当前33条均为AI编写的合成开发数据，不含真实参与者原答或独立专家标签。

- 28条规则回归：明确/委婉中英文无答案、NFKC变体、有效否定与符号、实质错误、假设验证、多个引用、显式dimension边界、英文词边界。每条比较共享规则的实际拒绝原因与声明预期；`null`只表示未命中已知负向规则，不表示支持评分。
- 5条语义挑战：否定验证、引用间目标错配、本人动作与他人贡献混杂、空泛“测试一下”、委婉跳题。单列`requires-semantic-review`及局限说明，不进入28条回归的成功分母；通过回归不关闭这5类缺口。
- 报告保留datasetDigest、ruleDigest和runnerDigest，以及humanReferenceCount=0、qualityClaimEligible=false、semanticSupport=not_verified。摘要不是模型准确率、人工校准或系统教学效果指标。

新增回归发现并修复了：三个确定的整句无答案表达未识别；英文latest内的test子串导致误放行，brisk内的risk子串导致误拒绝。整句表仅新增明确短句，不泛化剥离任意礼貌词/未知短语；英文词边界保留tested/testing等变形。多个引语顺序/重复的纯规则结果保持一致；执行器有依据的混合引用删除无答案ID，保留实质验证ID和原评分，不将整份回答误弃评。

这些仍是有界负向规则。否定、指代、目标关系、验证方案充分性需更深入语义评估；不能用关键词或本数据集28/28宣称已解决。开发集不是独立保留测试集，后续任何调参都应以新增审核材料验证。

## 显式验证证据绑定

`verificationGoal`是宿主量规的可选、版本化要求，仅允许出现在dimension=verification的标准上。字段包含id/version以及actionAliases、targetAliases、observationAliases（每组1–12个字面量）。这些别名描述允许的操作、目标与可观察指标，不是模型自定规则，不使用模型提交的正则表达式。

模型对数值评分提供`verificationBinding`：goalId/goalVersion、mode=proposed/reported，以及action/target/expectation三个{evidenceId,start,end}。坐标使用原答UTF-16，三个部分必须位于同一条已登记且被该维度引用的证据内、非空、互不重叠、各最多500代码单元；不得拼接不相关引用或把同一段全文重复充作三个部分。

共享`packages/interview-domain/src/verification-binding.ts`核验：

- `invalid`：未声明goal却提交binding、goal版本不符、伪造/未引用证据ID、越界/跨证据单元/重叠。执行器严格拒绝，不能洗成合法弃评。
- `insufficient`：缺少绑定、操作线索不符合宿主要求、明确局部否定操作、目标或可观察指标不匹配。允许弃评时该维降null并清除binding，不写掌握度；严格模式拒绝。
- `bound`：结构与字面约束通过，semanticSupport仍not_verified；`not_required`：旧量规没有goal且没有binding，不隐式升级规则。

例如Java幂等目标要求“并发重放／同一幂等键／订单数”，检查“按钮颜色”不能满足订单数指标；Web竞态目标可声明“逆序返回／同一搜索框／最新输入”。“预期订单数=2”仍包含相关验证过程，绑定可以通过，但其技术错误可由量规评0；字面校验不替模型决定分值。proposed/reported仅是对回答叙述的标签，不是外部执行凭证；不能据此证明学生真的测过。

该机制经评分、报告重算、候选提交与恢复共用；知识条目生成量规和benchmark转换也保留goal。Pi提示要求仅对宿主声明goal的数值标准提供绑定，不得编造动作/结果。缺少绑定可能是模型未提取完整，不能据此断言学生没有相关能力；保留静态原因与未知状态。

新机制显式启用，不修改旧知识/量规版本、草案审核、真实回答或旧评分。正式内容采用时必须发布新的知识/量规版本并走既有审核流程。本轮提供两岗合成离线示例与真实Pi本地provider回归，当前题库并未全量迁移。原有5类通用语义挑战仍保持未解决，不能把结构绑定当通用否定理解、因果/充分性验证或独立专家评分。

验证入口：`bun test tests/verification-binding.test.ts tests/verification-binding-flow.test.ts`。静态诊断新增verification-binding-missing、verification-action-absent、verification-target-mismatch、verification-observation-mismatch，不包含原答。

两岗可运行示例：`bun run agent:verification:demo`。输出明确标注assistant-authored-synthetic-development，使用真实Pi SDK的本地固定provider；不能当真实供应商/真人评分验收。

新版本候选的别名风险可运行 `bun run knowledge:verification:review`。审核包从独立proposal工作区读取两岗草案，不更换当前题库；24个AI开发例子包含20个规则回归及4个已知误放行/误弃评风险，必须分开报告。详见[知识维护](knowledge-curation.md)。

同义别名修订保持原24条开发案例不变，加6条配对样例按同一规则比较。新增潜在误放行会阻止建议采纳，即使潜在误弃评减少。当前v2候选因此changes-required，仍是独立草案；不得把开发集覆盖改善标为独立语义支持或RSI效果。命令：`bun run knowledge:verification:compare`。

## 指标值与条件绑定（显式新版本）

新量规可在 verificationGoal 增加 `observationPolicy: {kind: "count" | "duration", conditionAliases: string[], predicateAliases?: string[]}`。这不是旧题库的自动迁移：须定义新的目标/量规版本并审核，现有 v1/v2 候选及其冻结案例保持不变。

启用后模型必须在 verificationBinding 增加 `observation: {metric, value, condition}`，每项为原答 UTF-16 引用。三项位于同一条已引用证据单元；metric/value 还须落在 expectation 内。metric 精确匹配宿主指标别名，value 接受有界计数、时长、变化表达，或宿主给定的精确谓词。只有精确谓词允许 metric/value 重叠，例如“没有超额”包含“超额”；condition 须含宿主条件别名。没有声明 policy 的旧目标不得注入 observation。

共享 `observation-value.ts` 检查值的局部语法、指标与值的距离（至多40 UTF-16单元）、句间分隔、有限样式线索和直接否定。指标和值之间出现字号/字体/颜色等有限线索时拒绝，把 actualDuration 标题字号增加20%当作性能改善不能通过。“成功数标签显示1”仍可通过结构检查；不能粗暴屏蔽所有标签/标题词。缺少细节、值类型不符或条件错配走未知/澄清；跨证据、越界和未授权字段严格拒绝。相关但技术错误的“成功数最多100”仍可绑定并由量规给0分，不把错误答案混同缺证据。

这些仅是有限结构规则：不校验计算正确性、全部单位等价、条件语义等价、因果充分性、一般否定/指代，也不证明真实执行。变化方向允许没有百分比，条件允许出现在同一证据内其他位置；复杂关系仍需独立审核。合成测试的 span 已注入，本地 Pi 回归也使用固定输出，不能宣称已验证真实模型抽取质量。

运行 `bun run agent:observation:demo` 查看两岗14项合成探针（6项相关控制、8项样式/条件/跨句反例）；运行 `bun test tests/observation-value.test.ts tests/observation-value-flow.test.ts` 验证评分、弃评及报告重放。默认知识草案审核、历史评分与策略发布状态不因此改变。

## 条件的局部归属窗口

显式observationPolicy还要求condition、action、target、metric、value的最小覆盖区间不超过200个UTF-16单元，且不能跨句、换行、分号或已列出的明确分支转换（例如“否则/另在/else/otherwise”）。范围包含condition引用本身，扩大引用不能藏起分隔符。条件可放在结果后；所引窗口以外的历史说明不受此限制。小数中的点不会按句号拒绝。

这是保守的负向规则，不是一般条件/因果解析。合理但跨句、过长或使用受限标点的说明也可能被保留为未知，应走澄清而非0分；同句“条件只是旁注，主实验……”等关系仍可能放行，semanticSupport仍not_verified。无policy的旧量规不适用新窗口。

`bun run scripts/demo-condition-scope.ts` 展示两岗20项AI合成注释探针：8项正常局部控制、10项明确不相关拼接、2项尚未解决的同句归属风险。测试入口 `bun test tests/condition-scope.test.ts`；未发真实模型请求。v3候选的18条原案例及标签保持冻结，原2个跨句风险在新规则下拒绝，仍保留known-risk分组；新审核包显示当前结果和冻结说明，不能复用旧摘要或将风险组计入回归分母。v3 README中的初始结果是该候选编制时的快照，当前结果以新导出的包为准。

## 宿主选择的定向澄清

当合法评分仍不完整，且所有缺失维度都是宿主声明observationPolicy的verification维度、原答不是明确无实质作答时，宿主选择固定observation-v1模板，询问“本次验证条件、操作及对应观察或预期结果”，允许一句说明关系或明确不确定。不展示正确值、技术方案、模型反馈或内部诊断。混合缺失和明确不知道保持旧通用模板；这只是观测焦点，不声称已判断具体因果错误或学生没有能力。

`packages/interview-domain/src/clarification.ts`集中选择资格与回执文本校验，Agent和业务客户端共享。回执可选clarificationTemplate=observation-v1；无此字段的旧回执仍只接受原固定neutral文本。恢复、提交与后续追加均核对模板、宿主量规、缺失项及原答前缀；摘要不能授权任意提示或替代宿主保留最新回执/CAS。终态弃评不带模板，提示为null。

澄清不增加请求，也不重试模型；学生补充后才沿已有计量/预算链重新评估。限次、剩余时间、取消、原答只追加和未知不写掌握度的规则保持。默认CLI maxClarifications=0的材料采集仍直接弃评，本轮未改变默认策略或开展真实用户体验验收。

验证：`bun test tests/targeted-clarification.test.ts tests/targeted-clarification-workflow.test.ts`；演示：`bun run scripts/demo-targeted-clarification.ts`。均为注入评估输出的离线机制回归，不证明真实模型提取、学习收益或独立评分质量。

## 澄清闭环开发评测

`bun run agent:clarification:eval` 执行双岗位16条注入输出/引用的离线序列，逐轮运行真实编排函数：补充后可评分、继续待澄清、次数耗尽、初始/补充后时间不足、零分通路、预取消、同句语义风险。14条规则回归与2条风险分开；固定输出不是模型推理或真实用户作答，零分通路不验证该分数的语义合理性。

当前开发夹具中10条回归序列实际发出过澄清，其中4条后续可评分（含2条零分）；结构闭合4/10，不是学生提升率、模型准确率或提示的因果效果。另有2条继续待澄清、2条次数弃评、4条时间弃评及2条预取消；风险序列虽可评分仍标requires-semantic-review，不进入修复率。提示次数与最终闭合分别统计，不能把提示发出算成功。

产物位于新的 `.cache/clarification-loop/run-*`，report.json仅含静态ID、逐轮状态/计数/分数投影、案例/完整源码摘要，report.md展示分母和风险。不会保存原答/引用，不修改知识、旧分、人工参考、预算或默认CLI限次。执行前后核对源码一致，失败回归可保留failed-regressions产物，不改标签制造通过。

`bun run agent:clarification:eval --verify <report.json路径>` 只读校验schema、状态约束、案例身份/分组、汇总与当前源码；不重跑编排或模型，SHA不是签名或执行身份认证。旧源码漂移须重新评测，不能只重算外层摘要。未验证真实抽取、独立语义质量或真实学生体验。

## 定向澄清的跨进程持久恢复

`bun run agent:clarification:durable` 用两岗合成材料运行实际子进程，完成定向澄清后直接退出；父进程重开SQLite，在禁用在线授权、凭证/HTTP依赖拒绝调用时重放原run，对照子进程保存的结果、完整SSE和预算摘要。真实Pi SDK与网络解析/usage计量参与，但fetch和凭证完全注入，无真实供应商请求。

恢复后的合法追加使用新run，原回执、原答前缀与宿主量规仍校验；每岗仅产生一次续答评估和一个能力候选观测。重复新run原样返回、无新增台账；同run改请求冲突，改写原答在模型前VERSION_CONFLICT。改写失败仍占一个任务准入run次数，不能声称所有配额零消耗；没有新增HTTP/token台账。

每岗260 tokens来自两条per-run台账的合成usage（各130），只是验收聚合，不是供应商账单或跨会话全局额度。新缓存产物保留SQLite和合成payload，readable report只保留机制摘要。覆盖的是已完成澄清后的进程退出，不是在途模型请求崩溃；在途未知消耗仍沿现有unknown/人工对账规则，不自动复派。Agent操作持久化不等于API已正式提交会话，所有权、CAS和业务事务仍需宿主执行。

专项：`bun test tests/durable-clarification.test.ts`。默认知识、真实答案、旧评分、AI标签及已有unknown记录不变；本轮没有真实用户或语义质量验收。

## 澄清续答在途崩溃与对账

`bun run agent:clarification:inflight`：真实子进程先完成定向澄清，再于续答fetch派发后exit23，父进程重开SQLite并通过注入时钟推进租约到期。原澄清回执及已结预算保留，续答变interrupted/failed，已派发预留转unknown且不释放；旧run原样失败重放，新run在unknown未清前被阻止，恢复阶段不读取凭证/派发。

身份错误、过期expectedVersion与冲突usage对账拒绝且不改账。宿主显式提供合成usage后落库，再次重开库验证相同对账回执幂等、预算持久。对账不补模型结果，旧失败快照保持不变；只有显式新run可继续追加评估，重复新run不重复计量。

每岗390是三条per-run台账（初次130、崩溃请求宿主合成对账130、新请求130）的验收汇总。authority仍host-supplied-usage-not-vendor-verified，不是真实供应商账单、网络取消成功或跨会话全局额度。CLI全部注入传输/凭证，真实模型调用0；未模拟迟到账单、网络分区或电源断电，正式API对账权限/CAS仍需宿主执行。

专项 `bun test tests/inflight-clarification.test.ts`。缓存保留合成payload与SQLite，report.md展示机制结果；默认知识、原答/旧分/AI标签及既有unknown记录不受影响。本轮验收沿用既有恢复机制，没有为通过测试自动重试或放宽预算。

## 崩溃恢复的 HTTP/SSE 客户端联调

`bun run agent:clarification:http` 在真实127.0.0.1 TCP上运行Hono和内部客户端，复用续答派发后exit23的双岗合成崩溃夹具。旧定向回执可经HTTP返回，失败execute仅POST一次并传播错误；unknown阻断的新run也仅POST一次，不自动新建/重发任务。retryable是错误提示，不能当创建新run或重复外部调用的授权。

一次真实SSE回放响应在完整帧后由传输夹具截断；客户端以Last-Event-ID重连，事件连续无重复。服务实例和SQLite关闭重建后，新客户端显式携带保存的afterSeq，恢复尾部事件和同一预算；错误attempt和未来游标被拒绝。此处不证明SDK会持久化游标，也不代表真实代理/网络分区或跨机故障转移已验证。

对账仍走受控宿主直接方法，不新增HTTP对账接口。对账后显式新run通过HTTP/SSE完成一次注入模型评估/一个候选观测；重复提交返回同一结果、预算不变，旧失败不变。模型fetch/凭证/usage均注入，真实供应商调用0，390仅是per-run合成usage汇总。业务正式事务、所有权和CAS仍由API负责。

专项：`bun test tests/http-recovery.test.ts tests/inflight-clarification.test.ts`。可读产物保存在新的 `.cache/http-recovery-acceptance/run-*`；源文件前后指纹核对，不改默认知识、原答/旧分/AI标签或既有unknown。
