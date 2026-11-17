# 学习完成证据与复测配对

## 完整答题排除与证据边界

新createPrediction从已核验源报告保留全部priorEvidence/本场观测题ID，以及unscoredAnswers中的缺证据/弃评题ID。未评分题只进入排除集合，不新增能力观测、评分或学习完成证据。sourceQuestionIds上限4400对应公开报告4000历史+200评分+200未评分；不裁掉记录来凑预算。planRetestQuestion和pairRetest共用冻结排除集合，保持不同题资格一致。

仅展示未提交的题不在报告答案中，宿主仍须提供完整askedQuestionIds；冻结对象不因升级自动回填。缺来源的旧预测不能追认为已经排除了所有曝光题，应保留原件并由受信宿主以原始来源重新安排合法的新预测/任务，不能在复测曝光后改旧预测制造先验。核心函数、离线示例和用户页面可用仍分开；本地学习RPC/存储尚未接入。

dataMode与源报告/参考依据继续交叉检查：模拟配对只进入模拟统计，不能靠把任务标签改为consented或参考basis改为human-reviewed把离线来源升级成真人证据。schema校验不能证明宿主上传标签与审核身份真实，独立人工审核仍需实际执行。

实现范围：Agent侧宿主函数、结构化学习事件、冻结预测、报告核验后的复测合格性与分组描述统计。没有学习HTTP/数据库/代码判题器/真人审核界面；artifact、参考评分与时间戳须由后端可信记录提供，schema通过不证明外部事件真实发生。

契约：packages/contracts/src/learning.ts。实现：learning/progress.ts、learning/retest-pair.ts。机器定义在evaluation-schemas.json中。所有输入均为已授权宿主数据，不是模型可自报身份或完成状态的工具。

## 从记忆到复练目标与发题前规划

这部分完善现有记忆/规划/学习模块，不新增默认自动执行链。新契约learning-planning.ts，宿主函数learning/practice-plan.ts与learning/plan-retest.ts；类型/schema留共享包，业务规则留宿主，模型不持有确认完成或覆盖预测的权限。

`buildPracticeGoals(memory,{userId,roleId,session,now,maxGoals})`先按已有规则恢复下一场状态，使用完整证据派生掌握/置信并复用rankSkills优先级。排除岗位相关性0的技能；掌握未知标no_evidence，掌握<0.6标weak_evidence，其余置信<0.5标uncertain_evidence；都是启发式练习候选，不是确定的学生能力诊断。最多默认3项/上限5项，附记忆版本、下一场sessionId、原时间/量规/模式证据及完整历史排题ID。附带证据复用有界召回，老证据可不在投影中但仍影响原估计/排题。函数不创建学习任务、不改变原记忆或普通面试策略。

宿主应从目标建立学习任务，使用原createPrediction在学习/复测题暴露之前正式保存预测。target是独立的预期复测难度/完整量规，可与源题量规不同；不得在看到答案后修改。题目候选必须由授权知识适配层提供question/rubric/source：题目ID绑定source.knowledgeId，岗位/内容scope一致，source版本与量规版本分别追踪。新函数不自动替候选重写量规，不证明来源真实性或人工审核。

`planRetestQuestion({userId,roleId,assignmentId,prediction,progress,state,now,askedQuestionIds,candidates,allowDraftKnowledge})`在发题前核对：

- 身份/岗位/任务一致，练习集与冻结预测一致；时钟和输入结构有效。
- 学习已核验完成，学习事件/核验时间不早于预测，完成时间严格早于plannedAt；预测严格早于plannedAt且未过期。
- 新场次配置目标技能，剩余时间大于30秒；dataMode一致，unverified不发复测，consented要求源证据live-model。
- 排除预测源题、显式已发题、当前场priorEvidence/observations的所有已见ID；目标技能、难度、完整量规精确匹配。
- 同技能既有历史的行为内容/技术内容构念必须兼容；不能发出随后必被内容范围校验拒绝的混合构念题。
- 默认只接受reviewed来源；draft仅在synthetic且allowDraftKnowledge显式开启时用于演练。不能用此标记认证真实审核。

输出是uncommitted-retest-plan：ready含候选，blocked含发题前条件原因，unavailable表示无匹配未见题。没有最近难度/其他量规/重复题兜底。ID不同仍可能是语义近重复，当前未实现语义去重。多个合法候选按题目ID稳定排序；候选选择是确定性宿主规则，不冒称新模型自主规划。

basedOn记录sessionId/stateVersion/progressVersion/plannedAt以及predictionId，但不是签名或提交凭证。API发题时必须重查可信身份、冻结预测、记忆/任务状态、版本与真实发题时间；若学习完成后有新暴露、任务取消/过期或版本变化，旧计划不能直接复用。ready不表示题目已发出，更不表示配对已合格；回答后仍走原pairRetest，核对实际时间、完整报告和参考评分。当前没有把该候选自动接进workflow HTTP，也没有实现持久发题/事务。

运行`bun run agent:practice:demo`展示双岗合成链路：原报告→记忆目标→冻结预测→未学习时blocked→核验后选不同题→实际evaluateTurn与报告重验→pairRetest合格。参考/学习/时间均为固定合成fixture、非Pi或真实模型调用；仍无法证明学习提升或真实审核效果。原`agent:learning:demo`继续验证配对/统计。

## 学习任务与事件

createLearningProgress接收userId/roleId/assignmentId/skillId、resourceIds、requiredExerciseIds、dataMode、now。dataMode=synthetic/consented/unverified，不把同意使用的真实记录和合成fixture混同。输出uncommitted-learning-progress，最多100事件，超限拒绝。

recordLearningEvent(snapshot,{identity,expectedVersion,now,event})校验用户/岗位/任务归属、版本、事件引用和时间；相同event.id内容相同幂等，变化VERSION_CONFLICT。旧重放可在后续事件后返回当前快照，不重记；新事件接受时间单调，occurredAt可晚补录但不能早于任务创建或晚于接收时间。

| kind | 必需数据 | 对完成状态的作用 |
| --- | --- | --- |
| resource_clicked | resourceId、occurredAt | 只进入in_progress |
| self_reported_complete | occurredAt | self_reported，不产生verified完成时间 |
| practice_verified | 已分配exerciseId、artifactId/verifierId/verifiedAt、occurredAt | 所有所需练习均有核验证据才verified_complete |

同一任务内artifactId不能重复使用来完成多个练习；verifiedAt在任务创建后且不晚于事件时间。summary按各练习最早核验时间计算verifiedCompleteAt，重复练习不刷新完成时刻。核验标记必须由后端/人工审核入口写入，本模块不实际执行代码或认证审核者。

## 冻结预测

createPrediction输入identity、predictionId、空学习任务progress、sourceReportInput/sourceAnswerId、issuedAt/validUntil、predictedTargetScore、predictorVersion、target{difficulty,rubric}。源报告重校验，所有源轮次用户须匹配，任务技能匹配源回答；预测前无已记录学习事件，源报告已生成，期限大于issuedAt且不超过7天。

输出frozen-learning-prediction保留独立预测目标分、来源模型成绩、题目排除清单、源会话/回答、预期练习ID、来源模式及目标量规/难度。predictedTargetScore由宿主预测器提供，本轮未新增真实模型预测。这里的“冻结”是不可变记录契约：API必须在展示复测题/接收答案之前正式保存并禁止覆盖，当前JSON对象本身不构成签名或数据库时间证明。

## 配对条件与输出

pairRetest接收identity、prediction、progress、retestReportInput/retestAnswerId、questionIssuedAt/answerSubmittedAt、now、dataMode及可选reference。reference含basis、reviewId/reviewerId、answerId、rubricId/version、score、reviewedAt；consented只接human-reviewed，synthetic只接synthetic-fixture，unverified不进入合格统计。真实模式同时要求源与目标报告live-model；live模型本身仍不能证明学生同意或参考评分真实。

先重校验目标报告与用户，核对题目/提交/观测/生成时间；合法但不满足条件返回ineligible及原因，绝不补分。条件包括：

- 同岗位、技能；不同场次和未见过的不同题，排除源历史及复测题发出前状态的priorEvidence/observations。
- 目标难度、完整量规定义/版本与预测一致。
- 预测早于题目暴露；答案在预测期限内提交。
- 全部预期练习已核验完成，所有记录的学习事件/核验时间不早于预测，完成时间早于复测题暴露；晚补录点击也参与此检查。
- 任务/模式一致，参考评分对应实际回答与量规，并在提交后、now前审核。

不合格原因包括learning_not_verified、learning_outside_window、prediction_after_retest_exposure、prediction_expired、question_repeated、session_reused、role/skill/difficulty/rubric_mismatch、reference_missing/mismatch/unverified、data_mode_mismatch等。身份/损坏报告等非法输入直接抛错误。

只有eligible返回referenceScore与absoluteError=|predictedTargetScore-referenceScore|；ineligible相关字段为null，不当成0。单配对误差不是总体MAE，也不是学生成绩上涨幅度。输出kind=uncommitted-performance-pair，来源真实性与正式幂等键由API持有。

## 分组统计

summarizeCalibration输入roleId/skillId/dataMode/predictorVersion/targetDifficulty/targetRubric/pairs，严格匹配同组，异组/不合格计为excluded。拒绝重复predictionId、同一复测答案、同学生重复题或同学生同学习任务重复计数，防止一次暴露凑多个样本。统计信任宿主保存的配对结果，重算单误差/算术，不重新请求原报告或认证参考评分。

至少8个合格配对且2个学生才status=ready并计算MAE，否则insufficient_data、mae=null。2学生是首版额外工程防护，不是统计充分性保证。不同技能即使共享通用量规也不能混算；synthetic和consented永不合池，unverified不产生ready。此函数只给描述统计，不自动修改评分权重或启用策略，也不意味着教学因果改善。

运行bun run agent:learning:demo：两岗各展示点击不合格、练习核验后合格、单配对MAE=null、8个配对/2个模拟学生的synthetic MAE≈0.1。全部来自手工fixture，真实模型端点/真人学习与审核样本均为0，未写正式数据库。
