# 回答草案参考集与离线评分误差

本模块为后续模型评分提供可审核的对照材料和运行器。当前18条回答与参考均为assistant-authored合成草案，人工独立标注为0；没有真实模型准确率、评分改善或教学收益结论。所谓“独立”指参考文件与推理输入分离、题族分组隔离，不意味着独立人工作者或专家金标准。

## 数据与分组

| 文件 | 内容 |
| --- | --- |
| evals/answers/manifest.json | 数据ID/版本、作者来源、六个题目的知识内容/来源摘要pins |
| evals/answers/cases.json | 每岗三个题族，各含较完整、明显误解、信息不足回答，共18例 |
| evals/answers/references.json | 单独存放草案分维分数、回答原文引用、解释、case/rubric摘要；全部synthetic-proposed/draft |

development、validation、reserved-final各6例（每岗3例），按题族分割。同group跨split、同questionId换group、规范化后相同回答跨split均拒绝。规范化做NFKC、空白移除及小写，用于近似重复检查，不做语义相似判断；变体家族仍依赖维护者正确声明。

题目和量规来自当前知识包，但回答与标签另行编写。pins绑定题目+dossier及完整来源元数据；题目、指南或来源变化会报ANSWER_DATASET_STALE。每条参考另绑定caseDigest和rubricDigest；回答变更或引用片段不匹配拒绝。数据digest还覆盖参考标签本身，所以修改标签后旧报告不可按新集校验。修改材料应同时更新版本，不能重算摘要来伪装原审核结果。

这些合成样例没有增加evals/datasets/manifest.json中的真人/人工参考observedCount，其值仍为0。每岗9例草案远未达到原计划每岗60条人工核对回答的目标。

## 运行与审核包

```powershell
bun run agent:answers:eval
bun run agent:answers:eval --split validation
bun run agent:answers:eval --review
bun run agent:answers:eval --verify ".cache/answer-benchmark/run-实际目录/report.json"
```

默认只跑development，validation须显式选择；reserved-final在CLI和底层运行器均拒绝执行。最终草案存于仓库且包含在审核包中，只是预留分组，不能称为盲藏最终集，更不用于自动挑策略或调门槛。

每次在.cache/answer-benchmark创建新目录：运行产物report.json/report.md不包含回答正文、证据原文、反馈或上游异常；审核包packet.json则刻意包含原创合成回答、参考和量规，供实际审核者逐锚点提出修订。审核包命令不生成批准；当前契约只接收synthetic-proposed/draft。真实人工参考与同意使用的真人材料导入，需要明确来源、独立审核身份、契约和授权边界后另行实现。

CLI退出0只表示该次离线评估均产出合法投影，不表示误差达标；存在失败/取消/超时案例则退出1并保留报告。高MAE和过度给分会如实保留，没有为了“通过”而设置模型质量阈值。

## 模型输入边界与运行器

runAnswerBenchmark编译并复制数据，按选定split运行。给evaluate回调的只有当前回答、岗位/技能状态、问题和基准量规；不传caseId、variant、split、groupId、参考分数、参考解释或答题指南。模型可见题目/量规ID，但不能靠样例类别直接读出标签。此为代码数据流隔离，不是不同安全进程的物理隔离。

实际CLI调用真实Pi SDK，本地provider仅根据请求中的各维maxScore固定给一半，引用当前回答全文，不读取参考文件或按variant分支；网络模型调用为0。它会给信息不足回答分数，用来演示缺分分歧和误差，不是一个有语义能力的评分模型。

本基准把所有维度required设为false以测弃分行为，数值范围、权重、锚点与岗位口径仍绑定原题。它直接测评估器，不经过正式evaluateTurn提交：正式turn必评维缺失仍按原规则拒绝，不因基准允许null而放宽。

输出先过EvaluationOutputSchema，再校验UTF-16引用与原文一致、维度齐全/唯一、分数范围及证据ID。数值分必须有引用，null不得携带用于打分的引用；重复证据ID拒绝。字面匹配不证明引用在语义上支持给分，固定半分替身会体现这个局限。

每例独立Pi会话、无工具；外层有截止和取消，忽略信号的依赖不能迟到写入成功投影。截止也在同步依赖返回与输出验证后用单调时间检查，避免定时器回调被CPU阻塞而误接受；不能强行抢占同步CPU或保证远端计算停止。预取消不发评估请求，其他失败保留静态错误码、继续记下全部所选案例。

## 指标口径

### 引文支持判分的语义评测（现有评测完善）

原MAE只比较分数；现在增加独立的“被引片段是否足以支持该criterion记录分数”评测。数据在evals/answers/semantic/references.json，复用原development回答、问题/量规与知识pins；8个判定来自6条合成回答、2个题族，两岗各4个，并非8个独立学生样本。原validation/reserved-final不执行、不用于调门槛。编译仍校验原完整数据包，预留分组并非秘密盲藏数据。

每岗有全文支持、明确技术矛盾、信息不足、同一完整回答但错引验证步骤四种草案。最后一种反例保持回答和分数不变，只改变引文范围；整段回答其他地方正确，也不能用未引用句子补齐证据。claimedScore目前均为正确性primary标准4分。supported表示引用足以支持该分数，contradicted表示引文技术断言与该标准此分数冲突，insufficient表示尚不足以支持而非明确反向断言；judge也可uncertain。它不是对整段回答重新算分。

全部标签与解释仍为assistant-authored/draft，humanReferenceCount=0、qualityClaimEligible=false，不接受文件自改reviewed或把模型/代理复审当人工金标准。caseDigest/rubricDigest与baseDatasetDigest绑定原回答和量规；偏移须对应原文，重复判定/越界/跨development拒绝。语义理由是待独立审核的提案，编译通过不证明理由正确。

```powershell
bun run agent:answers:semantic
bun run agent:answers:semantic --review
bun run agent:answers:semantic --verify .cache/semantic-support/run-实际目录/report.json
```

运行模式如上；复核与候选对照模式见下文。运行时judge只收到问题、岗位、回答、当前criterion/锚点、claimedScore与引文；不传claim/caseId、variant、group、参考标签或解释。真实Pi SDK每例独立内存Session，无工具/个人资源发现，使用本地固定supported provider，不读参考按类分支；网络模型调用0。隔离是数据流边界，不是不同安全进程。原MAE评分器不变，新的语义judge不回写真实评分/反馈、不自动将semanticSupport改为已验证。

固定基线故意错误：8例全部completed，只有2例与草案一致（0.25），6个草案负例全被判supported，错误支持率1；宏F1约0.1333。这是坏基线的草案对照结果，不是模型准确率或质量提升。CLI退出0只表示全部离线判定完成且源码一致，不是语义达标。

报告按两岗分别保留混淆矩阵、逐类precision/recall/F1、宏F1、总量/失败/弃权/覆盖。accuracy=正确/全部，失败与弃权不移出分母，并计入相应类别FN。precision在无该类预测时null；F1按2TP/(2TP+FP+FN)，分母0才null。宏F1取有定义类别平均。错误支持率=被判supported的草案负例/获得明确判定的草案负例；必须同时看负例判断覆盖，全部失败或弃权时错误支持率null、覆盖0，不能显示0错误。失败摘要只保留静态错误码，不保存异常/模型原文。

每例默认5秒、上限30秒，支持宿主AbortSignal，预取消不调用judge；同步工作返回后再查单调截止，迟到不变成功。外层不能强制中断任意不协作异步或CPU阻塞；Pi适配收到取消后abort并dispose，未验证真实供应商资源停止。

运行产物位于.cache/semantic-support/run-*的report.json/report.md，不含回答正文/引文/参考理由。review-*的packet.json刻意包含原创合成回答、量规、引用、草案解释，供实际人工复核；导出不创建批准。只读verify对schema/指标/摘要/数据pins/当前源码重新核对，不重跑judge，不将SHA当签名。读取上限4MiB、严格UTF-8、拒绝符号链接。Markdown为展示副本，权威复验对象是JSON。

机器定义仍放answer-benchmark-schemas.json。当前没有真人标注导入/审核认证、新付费模型接入或业务HTTP接口，正式API仍501；新评测回归纳入全仓test，统一交付仍固定14阶段，专项报告需单独运行本命令。

按岗位分别输出，不用两岗混合均分制造效果。

| 字段 | 定义 |
| --- | --- |
| totalCount / completedCount / failureCount | 所选案例总数、合法输出投影数、失败/取消/超时数；失败不会被移出总分母 |
| fullyScoredCount | 预测每维均非null的回答数，绝非获得满分的回答数 |
| criterionError | 每维除以各自maxScore；仅双方非null时累加绝对误差/有符号误差，除以pairedCount得到MAE/偏差 |
| dimensions | 按量规dimension分组的同一误差口径，仍显示配对数 |
| weightedError | 仅双方全部维度非null时计算原权重总分误差；不对剩余维度重新归一化 |
| nullAgreement.overScored | 草案参考为null、预测却有数值的维度数；并非一般意义的“预测分高于参考” |
| nullAgreement.underScored / bothMissing | 参考有分而预测null、双方都null；失败行不伪装成弃分 |
| humanReferenceMae | 始终null，humanReferenceCount=0，qualityClaimEligible=false |

pairedCount=0时MAE和偏差为null，不填0。全弃分可能没有任何数值误差配对，必须同时看underScored与覆盖；全失败同样不能展示“零误差”。偏差=预测减参考，正负可抵消，不能只看偏差不看MAE。

当前固定半分演示在两岗development与validation均得到：每岗4个维度配对、MAE0.5、偏差0；完整回答配对2例、加权MAE0.5；每岗2个“参考缺分但预测给分”维度。只是草案算术对照，无统计充分性或模型质量结论。

## 报告校验与协作

### 复核记录与标签修订（现有评测完善）

`--review`现在额外导出空ledger.json和operation-template.json，模板所有decision/checks均为null，不能直接导入或默认批准。packet.json包含原始合成材料，ledger只保存基线标签/摘要与操作历史，不复制回答全文。实际岗位审核者应逐锚点判断；模型、代理复审或导出动作不能冒充人工批准。

```powershell
bun run agent:answers:semantic --review
bun run agent:answers:semantic --review-status .cache/semantic-support/review-实际目录/ledger.json
bun run agent:answers:semantic --review-apply 路径/ledger.json 路径/operation.json --actor reviewer-id
```

从模板中复制单条operation，填写operationId、occurredAt（毫秒时间）、decision/checks/note；每次按最新ledgerVersion更新expectedLedgerVersion，不把八条初始模板当自动批量批准。actor由CLI/宿主注入，不允许放进operation冒认身份；CLI的actor参数只是一条未认证声明，不证明真实人员、独立性或审核发生时间。当前不读取账户/密钥或接入认证系统。

两类操作：review_label记录approved或changes_requested，绑定当前claimId/requestDigest/expectedLabelVersion/labelDigest；approved要求literalMatch/criterionAlignment/scoreSupport全true。revise_label提供新reference{verdict,rationale}与changeReason，标签版本+1，即使仅修订理由也需重新复核；旧意见保留在records但不适用于新版本。版本0基线作者为assistant-proposed，修订作者来自宿主actor；不能复核自己的当前标签。同一actor对同版只能记录一次；同版出现批准和修改请求则disputed，不以最后一条批准覆盖争议，需修订后重新审核。

账本全局CAS与单标签版本同时检查；同operationId、同内容、同actor重试幂等，不刷新接收时间或增加版本。旧版本、新ID覆盖、改内容/改actor重放、错请求/标签摘要、时钟倒退与缺检查均拒绝。SHA和回放只验证一致性，不能阻止能够重写整份文件与摘要的攻击者，也不是可信审核者认证。

数据集摘要与基线绑定原请求（含回答/引文/量规）及标签。数据集改变后旧账本可只读查看，所有状态stale_held、当前批准数0；禁止直接追加/重绑定，须另建并显式复核，当前不自动迁移。初始模板版本0不是基准文件的修改权限。文件上限4MiB，严格UTF-8，拒绝符号链接/非文件；账本最多2000操作，文件限制可先达到。CLI导入在新的.cache/semantic-support/review-ledger-*输出ledger/summary，拒绝覆盖输入原文件。

公开状态declared_approved仅表示本地声明通过规则。authority恒file-declared-unverified、humanReferenceCount=0、qualityClaimEligible=false，当前账本既不覆盖references.json，也不进入默认评测标签或把生产报告semanticSupport改为已验证。正式人工参考导入仍需可信认证、归属、时间和批准入口；这些未在本轮实现。原模型/语义评测默认行为不变，没有新业务HTTP或数据库迁移。

### 候选标签隔离对照

```powershell
bun run agent:answers:semantic --compare 路径/report.json 路径/ledger.json
bun run agent:answers:semantic --verify-comparison 路径/comparison.json 路径/report.json 路径/ledger.json
```

两份输入必须绑定当前数据；预测报告还须符合当前源码manifest且sourceStable=true。允许报告包含失败/弃权并完整保留分母。对照不重新调用judge，仅用同一份rows计算原草案与候选指标，不能解释为模型改进或教学收益。

候选仅采用labelVersion>0且当前状态declared_approved的修订，包括仅理由变化的修订；adoptedCount表示采用了该修订，不保证verdict改变。未修订、未审核、要求修改或争议项继续使用原草案，claims逐条给出baseline_unrevised/unreviewed/changes_requested/disputed或adopted、标签版本/摘要与原/候选verdict。旧数据集直接拒绝，不能借此解除stale或把旧批准用于新标签。仍是本地声明，不是真实人工金标准。

输出新.cache/semantic-support/comparison-*目录的comparison.json/md，不覆盖输入、references或正式报告。全量及两岗各保留原/候选混淆矩阵、F1、一致率、错误支持率与覆盖；候选变化可改变负例分母，必须一起看unsupportedTotal/unsupportedJudged。没有候选时指标相同，不制造提升。JSON不含回答、理由、actor。comparison绑定预测digest和ledger digest/version；复验用两份原输入重建全量对照，不是只校验SHA。读取上限4MiB且严格UTF-8/拒绝链接；Markdown只是展示，JSON是复验对象。命令失败退出2且公开静态错误，不回显材料。

authority=file-declared-unverified、humanReferenceCount=0、qualityClaimEligible=false、inferenceReexecuted=false、baselineOverwritten=false。选择规则固定而非模型自主发布，无新HTTP接口或数据库提交；这些指标差异不能自动触发评分/RSI上线。

共享契约见packages/contracts/src/answer-benchmark.ts、semantic-comparison.ts和[生成Schema](answer-benchmark-schemas.json)。原回答基准--verify最多读2MiB JSON，检查数据digest、严格结构、案例完整性/归属/量规、数值范围，重新计算指标并核对报告摘要；不重跑推理，不重做证据语义审核。

报告中的assessmentDigest只是当时完整评估输出的摘要；原始正文不在报告中，因此投影校验不能重新验证原引用。所有SHA都是变更检测，不认证来源或执行。当前报告不提供代码签名、安装依赖证明或供应商调用记录，evaluatorId是宿主声明的标识。

后续先由实际岗位审核者独立检查锚点、片段、null与分数，分歧留痕；再接入已授权模型固定版本与预算，保持分组隔离。不要拿这18条草案反复改标签使模型“通过”，不要从评分对照直接调整正式学生成绩或发布RSI策略。

引用负向规则的可重复开发检查：`bun run agent:answers:evidence`。其28条规则回归与5条未解决语义挑战分开统计，全部为合成开发样本；不合并入真人/人工校准指标。规则、案例和runner摘要保留在独立新目录的report.json，未命中规则仍为not_verified。详见content-rubrics.md。

带verificationGoal的新量规通过结构化action/target/expectation引用绑定验证目标；宿主id/version不匹配或伪造引用拒绝，证据链不足允许弃评。Java幂等和Web竞态合成场景覆盖实际Pi本地provider→评分→报告重放，候选恢复按相同规则复验。旧量规不隐式升级、真实题库不自动迁移，通用语义挑战与人工金标准边界保持不变。见[显式验证绑定](content-rubrics.md)。
