# 岗位题型与多维内容量规

## 当前实现

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
