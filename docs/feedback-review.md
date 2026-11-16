# 反馈事实与引用支持度复核

这是 Agent 的离线质量复核工具，不接入模型 Stop 门控，不修改原始评分、反馈、知识审核状态或业务数据。新生成的内容报告会使用同一复核规则过滤展示反馈，详见[反馈发布隔离](feedback-publication.md)。引用位置合法只能证明片段来自原答，不能证明反馈得到语义支持。

## 使用

```powershell
bun --no-env-file run agent:feedback:review --batch .cache/quality-batch/run-LUl9hR
```

输入为已冻结的质量批次目录，读取 `batch.json`、`report.json`、`execution.json`、`config.authorized.json` 和报告列出的岗位/阶段请求文件。配置只包含凭证环境变量引用；不查环境变量、不创建模型运行时、不发网络请求。输入文件限 4 MiB，要求普通文件、有效 UTF-8 和对应 schema。失败退出码 2，错误不打印原答或配置。

输出新目录 `.cache/feedback-review/run-*`，包含带摘要的私有 `report.json`、完整候选的 `review-packet.json` 和经过隔离的 `display-feedback.json` 展示预览。前两者供复核与追溯，不能当成学生展示数据。历史报告和 SQLite 保持原样。报告记录历史源码清单摘要与本次分析器源码清单，允许对旧批次做回溯分析，不把当前代码冒充当时执行代码。

## 事实规则的边界

`apps/agent/src/evaluation/feedback-review.ts` 的 `capacityProfile` 固定题目 ID、岗位、版本、题干 SHA-256 和宿主量规 SHA-256。规则前提为上限 100、初值 99、单轮无归还或重试、正确原子实现，因此最大新增成功数为 1。该结论不约束不安全 get/check/set 实现实际可能放行的请求数。

只识别完整、明确的有限句式，例如“初值99时正确最大成功数应为99而非100；需修正该数值错误并解释为何不能超额到100”。99 与期望 1 不符，返回 `contradiction`。版本或内容变化、引用、否定、自由表述均为 `not-covered`。`matched-restricted-claim` 只说明这一条受限算术断言一致，不证明整段反馈正确。规则是开发草案，不能据此批准正式知识。

## 引用复核与人工材料

每条亮点/改进意见生成独立任务，保留完整题干、原答、反馈与候选证据。先校验 proposal 的会话/回答/题目/量规身份及 UTF-16 引用位置；候选证据仍然不是逐条反馈的支持证明。亮点提及“竞态/竞争/并发窗口”、原答未出现对应字面词时，只产生待审提示；有无这些词都不能代替语义判断。

复用 `evals/field-evidence` 导出盲审材料：不含模型分数、自动事实判定或疑点提示，标签、审核人及时间留空；完整私有报告用于追踪来源。原答可能包含身份细节，分发前仍需检查脱敏。现有导入工具校验内容摘要与声明独立性，但不认证审核人的真实身份。

出现算术矛盾时离线报告状态为 `blocked-fact-contradiction`；否则为 `pending-independent-review`。两者均 `qualityClaimEligible=false`、`humanReferenceCount=0`。未评分、澄清和失败的历史行验证身份后跳过反馈复核，不填分、不编造反馈；未覆盖的技术判断仍需要独立审核。

批次/报告/配置/原请求摘要和题目绑定校验是文件内部一致性检查，不是签名认证或真实用户证据。当前工具不证明评分准确率、正式验收通过或生产质量提升。
