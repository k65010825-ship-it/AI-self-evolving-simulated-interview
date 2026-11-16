# 人工审核与真人 cohort 证据采集

该工具提供**采集、导入和描述性分析**。仓库附带的是空任务/空 cohort，不含专家签字或真人提升结果。所有 JSON 身份、同意、练习、审核记录均标为 `file-declared-unverified`；命令不能认证身份，不能使知识正式发布，不能建立 RSI 因果效果。`passed` 只表示文件声明的工程门禁通过。

## 可运行入口

在项目根目录执行（本机 PATH 没有 Bun 时，将 `bun` 替换为 `& .\node_modules\@oven\bun-windows-x64\bin\bun.exe`）：

```powershell
bun run scripts/field-evidence.ts export evals/field-evidence/review-input.empty.json .cache-review-packet
bun run scripts/field-evidence.ts reviews .cache-review-packet/private-manifest.json .cache-review-packet/labels.json .cache-review-report.json
bun run scripts/field-evidence.ts cohort evals/field-evidence/cohort-input.empty.json .cache-cohort-report.json
bun test tests/field-evidence.test.ts tests/field-evidence-cli.test.ts
```

输出路径须为新路径，防止覆盖已有标注。目录导出保留完整绑定清单 `private-manifest.json`、可分发的 `review-packet.json`、待汇总的空数组 `labels.json`、知识审核模板。`private-manifest.json` 不分发给盲审者。将每位审核者填写的标签合并成一个数组，再执行 `reviews`。退出码：0=导出/合法proposal/声明门禁通过，2=已生成报告但 not_ready 或 failed，1=输入/绑定/写入错误。空数据的报告明确 `not_ready`，所有无数据比率为 `{numerator:0, denominator:0, value:null}`。不能将退出0作为人工身份或生产通过证明。

## 任务、盲审与导入

真值契约：`packages/contracts/src/field-evidence.ts`。输入每项包括 `id/sourceGroupId/authorId/version/roleId/kind/payload/modelScore/sourceReferences`。kind 为 answer、knowledge、continuation、expression；payload 放足够的原始问题、作答、引用原文与定位、量规、前后轮上下文或确认后的转写和观测证据。不要放用户姓名、分组、模型名或作者提示。工具隐藏清单里的原ID、作者、模型分数，随机生成 taskId，但不会替调用者清洗自由文本里的身份；分发前须检查 payload。独立盲审人员不得看到私有清单、模型分数或其他人的标签。

knowledge 必须有非空 `sourceReferences:[{sourceId,sourceVersion,locator}]`，来源信息与payload都纳入内容digest。开发组与保留评测组不得相交。标签严格校验、锁定taskId与digest；拒绝作者自审、开发reviewer参与保留组审核、同一审核者重复标同一任务、重复reviewId、修改内容后复用旧标签。审核者身份来自文件声明，尚非宿主登录认证，也非密码学签名。需在真实组织流程独立验证其资质、同意和独立性；本工具不会生成“已认证”标签。

每项至少两位不同独立reviewer填写reviewId、reviewerId、reviewedAt、rationale，以及该kind适用的humanScore（0~1）或布尔指标（见文末适用性）。适用字段为null表示未判断，不能作为通过；非适用字段填null。报告保留缺标task列表。评分比较仅是同量规归一化分数绝对差≤0.1的一致率，不是心理测量效度。

工程默认门禁：双人评分一致率≥0.90、模型/人工评分一致率≥0.90、引用支持率≥0.95、自然承接准确率≥0.95、无泄题率=1、表达可靠率≥0.95；默认最少8个完整任务。每个指标均输出分子/分母，评分一致率以reviewer对为单位，模型一致率以模型/人工评分对为单位，其余以非空人工标签为单位。任何任务缺少适用标签，或适用指标分母为0，都 not_ready；不适用指标不纳入此次门禁，requiredMetrics明确覆盖范围。不得跨不同角色或实验条件汇总后解释为普遍效度，应分包评测；样本选择、阈值与统计功效需事先确认。表达可靠性必须由对应观测证据支持；没有音频与合意采集，只能评价文本表达，不推断信心、情绪或人格。

知识审核导入：`bun run scripts/field-evidence.ts knowledge <private-manifest.json> <single-review.json> <new-proposal.json>`。单项JSON按导出的知识模板填 `decision/checks/note`；approved要求四个check全true。生成 `uncommitted-knowledge-review-proposal` 保留itemId/version、完整来源版本、taskDigest、reviewer/reviewId/时间、意见。它不会写catalog/reviews，不会把draft改成reviewed。已有知识发布仍走原有 `KnowledgeReviewSchema` 与 `buildKnowledgeCatalog` 的contentDigest/sourcesDigest门禁；新proposal的digest绑定整个采集任务，**不能直接冒充原有catalog的contentDigest**。维护者需针对当前知识workspace重新核对并显式采纳，保留对应追溯记录。

## 真人前后配对与 baseline/candidate

cohort契约提供studyId、两版policy、开发组、developmentReviewerIds（默认空，宿主须列出开发者）、每臂最小样本与pairs。每行须有脱敏studentId、arm、sourceGroupId、角色/技能/量规版本/难度、consentRecordId、learningArtifactId、before/after的answerId/questionId/sessionId/score/reviewerId/reviewId/时间；after还需questionIssuedAt。dataMode须为consented，before作答 < 学习验证 < 新题曝光 ≤ after作答。不能重复旧题/旧session/answer/review，也不能学生自评或一名学生同时进入两臂。合成/未验证、缺失观察或练习、开发组污染、开发reviewer评分、跨臂sourceGroup、错policy均排除并列出原因。任一排除/缺失都会让整个采集门禁 not_ready，防止通过静默删行掩盖失访。分母保留enrolled和eligiblePairs。

两臂必须同角色、技能、难度和量规版本，各达到预定最小样本；不同strata分别运行。报告给每臂提升人数/有效配对数、gainSum/gainDenominator、平均前后增益、两臂平均增益差。空/不完整数据不计算比较差。即使ready_descriptive，`causalEffectEstablished=false`、`rsiEffectEstablished=false`：未随机分配、未控制练习效应/选择偏差/评分漂移，不能把分数上涨说成Agent或RSI导致的真人能力提升。

本模块不取代 `learning.ts` 的正式学习事件/冻结预测/PerformancePair，也不写正式业务表。API宿主可把已授权的记录导出成上述输入；应在宿主层核验归属、同意、reviewer身份、时间、原始证据和冻结实验分组。当前CLI用于离线收集与校验，尚无真实cohort接入或身份认证保证。

## 当前知识开箱导出与界面状态

```powershell
bun run scripts/field-evidence.ts catalog .cache-current-knowledge-review
bun run scripts/field-evidence.ts readiness
```

`catalog` 只读导出仓库现有两岗全部24条（数量随知识库变化，以输出为准），逐项带原item/dossier、当前sourceId/version/locator、来源快照以及原catalog的contentDigest/sourcesDigest，便于人工对照。没有自动扩题、签字或发布。知识模板可以直接逐项填写，再用knowledge命令逐项导入proposal。`readiness` 输出待办与缺失状态，退出2。

API宿主可以导入 `evals/field-evidence/catalog.ts` 的 `fieldEvidenceReadiness()` 在产品中显示 `status/knowledge/cohort/actions`；该函数是**尚未接入采集存储的初始状态快照**，每次明确返回 pending/not_ready，不冒充持久化标注状态。已有实际数据用 `evaluateReviews(bundle, labels)`、`evaluateCohort(input)` 生成报告并由API持久化。renderer只消费API返回JSON，不导入该模块（模块会读Node知识catalog）。`actions` 给出人工审核、真实观察采集、真人配对、外部身份核验的操作条件；无用户填表不显示虚构提升。

审核完整性修正：公开taskDigest现在是公开task去掉taskId/taskDigest后字段的规范JSON SHA-256（键按字典序递归排序，参考 `contentHash`）；审核者可自行复算。私有item另有privateDigest绑定作者/模型分数等隐藏字段。每次导入还把privateManifest重新投影，要求与reviewPacket.tasks逐项严格一致；单独篡改分发payload、来源或版本会拒绝，不能复用旧label。

标签适用性：answer仅需要humanScore/citationSupported/answerLeaked；continuation需要continuationAccurate/answerLeaked；expression需要expressionReliable；knowledge一般label仅评价citationSupported，正式技术/量规/岗位审核另走知识proposal。其他字段填null，不进入该指标分母。`requiredMetrics`明确此次任务包实际覆盖哪些指标；未覆盖指标为null，不应理解为通过。模型评分一致率仅在answer带非空modelScore时适用。要证明各方面均被评测，应分别提供对应kind任务，不得拿仅expression包的passed宣称评分/承接/知识均通过。


