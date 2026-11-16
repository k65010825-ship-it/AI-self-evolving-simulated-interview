# 反馈发布隔离与复核回执

Agent 的评分候选、反馈展示和人工质量审核是三个边界。完整原答、模型反馈及候选分仍保留在内部 `turns[].proposal` 中，新建报告的 `assessments[].feedback` 使用过滤投影。评分、能力观测、记忆和规划不因反馈暂缓而改分或丢失。此机制不证明原评分准确。

## 规则与输出

实现为 `@interview/interview-domain/feedback-publication`，复核规则位于共享领域的 `feedback-review.ts`，Agent 原路径保留重导出。`projectFeedbackPublication(input, proposal)` 不访问 SDK、网络、凭证或数据库。

| 条件 | 展示状态 | 说明 |
| --- | --- | --- |
| 固定题目与量规下命中受限事实矛盾 | withheld / fact-contradiction | 暂缓原条目；不能直接复核放行错误值 |
| 亮点声称认识竞态，原答缺少对应字面线索 | withheld / citation-review-required | 只是待审疑点，不是语义不支持结论 |
| 未覆盖的自由文本或有限算术断言一致 | draft-unverified | 可作为带未验证标识的草案展示，不能宣称质量通过 |
| 宿主授权复核决定暂缓/恢复 | withheld / reviewed-unverified | 仅控制显示；不代表专家独立审核或评分校准通过 |

返回 `{feedback, publication}`。`feedback` 只有可展示条目，全部暂缓时两个数组均为空，不编造替代建议。`publication` 包含完整来源摘要、策略版本、原始类别/索引、条目摘要、暂缓原因与复核版本，不包含被暂缓的文本。`qualityClaimEligible=false`、`semanticSupport=not_verified` 始终成立。

报告额外提示 `feedback_items_withheld_pending_review`；量规练习卡独立生成，不受模型自由话术控制。`buildInterviewReport` 与业务端共享提交校验器均重算同一投影，不能靠删掉元数据或替换显示文本绕过校验。历史报告 schema 为兼容旧数据允许无元数据，但新报告提交必须匹配当前确定性投影；旧持久候选不会被静默改写。

## 候选复核回执契约

公共 schema 真值：`packages/contracts/src/feedback-publication.ts`；JSON Schema 见 `evaluation-schemas.json` 的 `feedbackPublication`、`feedbackReviewCommand`、`feedbackReviewReceipt`。

```typescript
// input/proposal 是宿主持有的原始快照，receipts 是宿主可信存储中的有序回执。
const view = projectFeedbackPublication(input, proposal);
const result = proposeFeedbackReview(input, proposal, receipts, {
  requestId, sourceDigest: view.publication.sourceDigest,
  expectedVersion: receipts.length, itemIndex: 0,
  decision: 'withhold', note: '保留原始候选，等待进一步核对',
}, hostContext);
// result.receipt 是未提交候选；由业务API认证、CAS落库、审计后再提供可信回执。
```

命令不接受模型传入的审核人或权限。宿主通过独立参数注入 `userId/roleId/sessionId/reviewerId/authorizedReviewerIds/now`，必须先完成认证和授权；这些字段是信任边界，不是一个可公开提交的自声明 JSON 身份接口。

回执绑定 `policyVersion + 完整input/proposal摘要 + 原条目摘要`，记录审核人、决策、备注、时间、顺序版本、请求 ID 与自身摘要。命令 `itemIndex` 是原始反馈序列的全局索引：先 strengths 再 improvements；显示元数据的 `kind/index` 是各类别的原始索引。原答、题目、反馈或候选内容变化后必须重新复核。重复同一命令返回原回执，换内容复用请求 ID、顺序版本冲突、未来/倒序时间、错误归属、未授权审核人、回执篡改均拒绝。最多 200 条回执，达到上限仍可幂等重放已有请求。

`release-unverified` 只能恢复非明确事实冲突的条目；事实矛盾需新建修正后的候选再复核，不能只改审核状态洗掉错误。模型输出 schema 不接受 publication 或回执字段。

## 集成边界与验收

本模块已接入新建报告和业务提交校验。内部运行快照、SSE 工作流候选仍含完整原始反馈，供业务端追溯，不能直接当学生展示接口。队友应从报告的过滤反馈与发布状态渲染；本轮未修改任何桌面代码。

复核函数已可执行，回执为 `uncommitted-feedback-review-receipt`、`host-declared-unverified`、`identityVerified=false`。当前未新增真实审核人的认证接口、正式回执数据库表或正式报告重新发布接口；报告生成默认采用零回执策略，后续业务端接管持久审批后再提供受控重新投影入口，不能把候选回执塞进模型请求或现有报告请求强行发布。

`agent:feedback:review --batch <历史目录>` 还会另存 `display-feedback.json`，只做过滤展示预览。私有复核报告和盲审材料仍保留原文，不能发给学生作为展示投影。测试使用合成 reviewer/注入模型输出，不代填真实审核、也不说明评分质量提高。

反馈修订后使用[版本化回放](feedback-revision.md)产生的 `revisionContext`：投影函数第5个参数、回执函数第6个参数都绑定该版本。即使文字恢复到旧版也不继承旧回执。该上下文由宿主从受检历史导出，不能交给模型或外部用户选择。
