# 岗位知识扩充与审核流程

Java 后端与 Web 前端各有 12 条原创草案：4 条历史 seed + 8 条 expansion。覆盖技术、项目、场景、行为四类；新条目包含分维度量规、0—4锚点，全部24条有适用条件、答题指南、追问及来源版本。没有人工批准，reviews.json为空，reviewed为0；数量增加不等于内容已审核或检索质量提升。

## 数据与职责

| 路径 | 作用 |
| --- | --- |
| knowledge/{岗位}/seed.json | 保留原4条种子，默认离线runtime仍使用它们 |
| knowledge/{岗位}/expansion.json | 每岗8条新增草案，必须显式启用curated adapter |
| knowledge/dossiers.json | 24条逐题答题指南、追问、适用条件、source/version/locator |
| knowledge/sources.json | 9个来源：8个外部文档和1个团队原创标识，记录读取日期与资料版本 |
| knowledge/source-checks.json | 本轮六页面MarkItDown读取记录；非空与相关章节已检查，不保存全文，不代表人工题目审核 |
| knowledge/reviews.json | 人工声明审核账本；当前为空，禁止脚本自动生成批准 |

新增技术材料来自 Java SE21 AtomicInteger、PostgreSQL17隔离、MDN微任务/Fetch；本轮也重读Spring事务与React useEffect。JLS和闭包来源沿用已登记读取日期。问题、指南和量规是团队原创概括，原始第三方页面不批量入库。以题目和dossier中的前提为准，不能把某版本数据库或代理事务规则泛化到所有平台。

本轮读取入口：[Spring事务注解](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html)、[Java21 AtomicInteger](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/atomic/AtomicInteger.html)、[PostgreSQL17隔离](https://www.postgresql.org/docs/17/transaction-iso.html)、[React useEffect](https://react.dev/reference/react/useEffect)、[MDN微任务](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide)、[MDN Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)。读取日期为2026-11-03，定位见逐题dossier，不能据此宣称人工审核通过。

共享Schema在packages/contracts/src/knowledge-curation.ts；[JSON Schema](knowledge-curation-schemas.json)由生成脚本维护。KnowledgeItem保持原字段；工具回执data新增可选guidance，对应返回itemId及来源。身份、岗位和目录由宿主注入，模型不能提交审核或更换目录。

## 命令

```powershell
bun run check:knowledge
bun run knowledge:review
bun run agent:knowledge:demo
```

knowledge:review创建.cache/knowledge-review/run-*，包含packet.json和review.md，记录当前内容/来源摘要、原题、指南、量规、适用条件及待处理项。只导出审核材料，不改源文件、审核账本或发布状态。审核包是生成时快照，审完后应重新导出并核对摘要，不能对旧截图批准新内容。

## 审核闸门

`buildKnowledgeCatalog(workspace)` 默认reviewed-only。作者文件必须保留draft，不能手改reviewed跳过审核；该状态由闸门计算。显式draft-preview返回草案，并保留标签。所有查验只在本地数据上执行，不运行网页指令或自动抓取来源。

逐题检查：

1. ID、岗位与技能构念不冲突；每条dossier恰好对应一个题目版本，来源引用齐全且唯一，量规权重和为1。
2. 正式批准前量规需包含dimension、evidenceRule、完整有序锚点；技术/场景题需有外部依据。四条旧技术/场景seed缺少完整元数据，显示rubric_metadata_missing；目前20/24条仅达到可送人工审核的结构要求。
3. 外部来源需content-checked且不超过默认90天维护期限；sourceVersion必须匹配。来源可读取不代表语义正确，90天也不保证URL期间不失效。
4. 最新审核记录必须绑定itemVersion、contentDigest（题目+dossier）及sourcesDigest（完整相关来源元数据）。题目、指南、量规或来源变化让旧批准失效。sourcesDigest也覆盖读取日期和许可说明；维护更新可能要求重新审核，这是保守取舍。
5. approved需四项检查均为true；changes_requested取消可用状态。日期不能在未来，批准不能早于所审核的资料；同题同一毫秒的多条决策拒绝，即使字符串格式不同，不能依赖数组顺序覆盖。

从当前审核包逐题确认technicalAccuracy（技术准确）、scoringClarity（量规可判）、sourceAlignment（依据吻合）、roleFit（岗位适配），由实际审核者填写唯一id、真实reviewerId、reviewedAt和决定，附当前itemId/itemVersion及两个摘要，追加到reviews.json，再执行检查。不得复制测试里的合成审批身份或将未完成的检查填true。需要修改则提交changes_requested或修改内容后重新导出，不复制旧摘要伪装批准。

该账本是**文件声明**：authority=file-declared-unverified，摘要不是签名，不认证审核者，也不发布正式题库。真实服务中的审核授权、身份验证、并发CAS、撤销日志、事务和发布审批属于业务API；Agent返回的reviewed只能说明这些本地闸门条件满足。代码测试中模拟通过/拒绝记录只用于验证规则，不进入真实账本。

## Agent访问与开发接入

可直接使用 `createCuratedKnowledgeExecutor(context)`；默认无批准时返回empty，不退回seed或draft。`{mode:'draft-preview'}`由宿主显式启用，仍按岗位/技能、有限关键词、Top-K≤3、次数/截止/取消过滤。模型可决定purpose：questioning获取追问和适用条件，scoring另外获得答题指南；purpose是内容用途而非审批授权。

Pi规划器新增宿主配置knowledgeMode：seed（历史默认）、reviewed-only、draft-preview。扩充预览还需输入allowDraftKnowledge=true才能通过宿主选题过滤。资料不预塞全部上下文，仍在工具查询后按当前规划技能和允许题目过滤；guidance同步过滤到返回的题目。现有工具字符预算仍生效。模型可能收到参考指南不代表评分结论正确，仍须回答证据和人工评测。

agent:knowledge:demo使用真实Pi SDK、本地固定provider及真实目录查询，两岗分别取原子计数/微任务题，preview选中且标draft，reviewed-only返回unavailable。它不测试真实LLM工具自主选择质量，不使用付费模型，不自动切换生产runtime默认知识包。

## 后续验收

需要岗位审核者检查原创指南与量规、补齐四条旧题、增加独立回答参考集，并测有限关键词检索的漏召回。每岗12题仍未达到团队40题目标；无法据此声称题库完备、评分校准或教学收益。正式导入以[PRD](prd.md)、[工具契约](tool-contracts.md)和业务API审核发布流程为准。

## 验证目标的独立候选工作区

[verification-goals-v1](../knowledge/proposals/verification-goals-v1/README.md)对Java并发容量与Web渲染两题提供新版本draft提案，原题/来源/审核文件不改，默认24题不增不换。执行 `bun run knowledge:verification:review` 导出新目录的自包含原题/候选/delta/摘要、档案与来源核对、24条别名开发案例、校准报告和空审核模板。

编译校验原题摘要与版本、候选版本变化、岗位、知识schema/来源关联及cases绑定，复用现有curation门禁；0批准、未发布。包内使用嵌入原题快照验证，方便之后原题升级时仍校验历史包；这验证一致性，不认证原始发布者。calibration还绑定规则/runner/案例/目标摘要；规则变化须重新导出，不能把旧报告当新版本结果。

20条规则回归与4条别名已知风险分开。两岗各存在潜在误放行1/5、误弃评1/7（仅对AI草案标签）；相关但技术错误的过程允许进入评分，因此expectedBound不能理解为答案正确。没有真实模型、真人标签、正式题库迁移或RSI效果声明；标注模板不预填reviewer、decision或布尔批准项。

## 同义别名修订的配对评测

[verification-goals-v2](../knowledge/proposals/verification-goals-v2/README.md)为独立候选，v1工作区和原24个案例/标签冻结。`knowledge:verification:compare`增加6条配对开发样例，两臂共享相同规则/runner、30条数据和校验日期。范围校验仅允许追加字面别名及升级版本，禁止删旧别名、同版本改规则或夹带题目/权重/来源改动。

原20条规则回归保持，修订覆盖2处潜在误弃评，但新增2处潜在误放行。比较器因此输出changes-required，未采用/未发布。对照不能只看改善项；新增负例误放行也参与采纳闸门。补充样例、原标签均为AI开发数据，不能称独立保留集或真实质量提升。

Web旧例“绘制用时”标签有歧义，保留原标签和待复核说明，不为了全绿改成错误类别或直接放宽别名；用明确的“渲染用时”补充例子评测修订。comparison.json包含前后快照、摘要、逐例转移、风险和建议；重算摘要不能隐藏伪造的采纳建议，但这些摘要不是签名或身份认证。

## 观测量规候选审核（v3）

运行 `bun run knowledge:verification:review --observation`，从 `knowledge/proposals/verification-goals-v3` 导出新的 packet.json、alias-calibration.json、review-template.json 与 review.md。仍为AI编写草案、0批准、未发布。正式基线锁定原seed-0.2；候选另立seed-0.5与draft-3-observation，不替换默认24题、不覆盖v1/v2，也不能冒充“只追加别名”的v2修订。

Java验证目标收窄为初值99的成功数/count；Web为相同交互的actualDuration/duration，避免把提交次数、筛选结果与时长用同一值类型处理。新题明确前提，验证锚点区分相关错误0分、缺提取未知、时长上升但正确解释的有效回答；不能仅因性能变差就评0。其他维度与权重保持原草案。

18条AI合成开发材料使用注入摘录：16条结构回归，另有2条已知条件归属风险仍会被局部规则放行。“正确条件出现在同一证据内”不代表它约束该观测；这两项必须独立列出，不能算作语义验收通过。模拟缺少observation的两条只测试提取缺失，不是学生能力判断。摘要绑定案例、目标、入口及委托规则；来源核对沿用前两版已有记录，本轮未重新抓取，也未获岗位人员批准。

空审核模板增加observationConditions/extractionCoverage，仍不预填身份、决定或批准。审核者需检查条件是否归属于当前结果、值类型是否合适、别名遗漏及锚点充分性。导出或填模板均不等于正式业务发布；真实模型抽取、独立评分质量与RSI效果仍需另行验证。
