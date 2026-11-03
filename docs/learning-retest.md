# 学习完成证据与复测配对

实现范围：Agent侧宿主函数、结构化学习事件、冻结预测、报告核验后的复测合格性与分组描述统计。没有学习HTTP/数据库/代码判题器/真人审核界面；artifact、参考评分与时间戳须由后端可信记录提供，schema通过不证明外部事件真实发生。

契约：packages/contracts/src/learning.ts。实现：learning/progress.ts、learning/retest-pair.ts。机器定义在evaluation-schemas.json中。所有输入均为已授权宿主数据，不是模型可自报身份或完成状态的工具。

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
