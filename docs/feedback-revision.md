# 反馈修订候选与版本化回放

版本链已可通过[会话收尾修订预览](closeout-preview.md)接入内部HTTP/SSE。它支持只读选择版本，仍不提供正式版本选择提交或报告发布。

修订只追加新版本，不覆盖原始 `TurnInput/TurnProposal`。评分、引文、题目、能力观测和规划状态均保持不变。新版本重新执行[反馈复核](feedback-review.md)与[发布投影](feedback-publication.md)，不会继承旧回执，也不会自动变成独立审核通过。

## 使用与代码入口

```powershell
bun --no-env-file run agent:feedback:revision:demo
bun --no-env-file run agent:feedback:revision:demo --replay .cache/feedback-revision/run-具体目录
```

默认示例使用两岗离线固定 provider，不读取凭证、不发真实模型请求。每岗有原始版本、反馈修订、回到原文字的第三个版本；回到旧文字后，原待审问题仍会被暂缓。示例话术和编辑者均是合成开发材料，不能当真人答案、专家批准或评分质量指标。

共享函数位于 `packages/interview-domain/src/feedback-revision.ts`，通过 `@interview/interview-domain/feedback-revision` 导出：

| 函数 | 输入与结果 |
| --- | --- |
| createFeedbackRevisionHistory | 用原始 input/proposal 建立第0版来源绑定 |
| proposeFeedbackRevision | 校验宿主权限、期望版本/头摘要后追加反馈版本，返回未提交历史、记录及回放候选 |
| replayFeedbackRevisions | 从原始快照逐版重建，只读返回 versions/currentProposal/projection/revisionContext |

跨层真值为 `packages/contracts/src/feedback-revision.ts`，机器可读定义见 `evaluation-schemas.json` 的 feedbackRevisionCommand/Record/History 与 feedbackPublicationRevisionContext。模型原始输出协议不接受修订历史、权限或评分更新字段。

## 源与版本绑定

命令仅允许 `requestId/expectedVersion/expectedHeadDigest/feedback/note`，反馈仍遵循模型反馈文字的长度和数量约束。命令不允许改分、证据、状态或自报审核身份。编辑者、允许编辑者列表、归属和时钟来自宿主独立参数，必须由业务端认证授权后注入。

历史保存原始源摘要、头源摘要与最多20条有序记录；原始快照由宿主另外持有。每条记录绑定父源、原始源、反馈、编辑者、时间、请求ID和顺序版本，计算独立 `revisionDigest`，再保存新源及发布投影摘要。即使反馈文字回到原文，版本/父源不同仍产生新的版本摘要，旧回执不会因此复活。

回放验证历史及记录摘要、父子顺序、归属、编辑者授权、单调且不超当前时钟的时间、重复请求、无变化版本、新发布投影摘要。原始输入变化、链截断/调序、策略不兼容或内容篡改均拒绝，不静默重写历史。SHA-256只证明内容一致性，不能认证编辑者身份或防止拥有全部文件写权限的人重建整条链。

重复同一个请求返回已有记录和当前历史，不重复追加；重放早期请求不会把头指针退回旧版。复用ID改内容、陈旧头或版本号、越权、空修改拒绝；20版上限后仍可重放已存在请求。查看旧版读取 `versions`；需要恢复旧文字时追加新版本，不移动历史头或覆盖记录。

## 与复核回执的衔接

修订回放始终从零回执计算默认投影。后续复核必须将经验证的版本上下文交给发布/回执函数：

```typescript
const replay = replayFeedbackRevisions(input, originalProposal, history, editorHost);
const view = projectFeedbackPublication(
  input, replay.currentProposal, trustedReceipts, reviewHost, replay.revisionContext,
);
// proposeFeedbackReview 的第六个参数也必须使用 replay.revisionContext。
```

`revisionContext` 必须来自可信宿主回放，不能接受模型或外部用户自报的摘要。不要丢掉上下文，仅把 `currentProposal` 当作原始轮次交给旧接口；这样会丢失版本身份。新版本可能仍含事实冲突或疑点，发布规则继续暂缓；未命中规则的文字仍是 draft-unverified。回放与投影的 qualityClaimEligible=false，回放的 identityVerified=false，不据此改变原始评分。

## 进程重启后的开发回放

示例在新 `.cache/feedback-revision/run-*` 目录写入：

- `bundle.json`：原始快照、版本链和合成宿主上下文，私有开发材料。
- `replay.json`：逐版重建结果，含原始/修订全文，不能直接当学生展示数据。
- `display-feedback.json`：当前版经过过滤的展示预览。
- `manifest.json`：固定文件字节摘要、生产者源码清单与证据边界。

回放只读固定文件名，拒绝符号链接和超过4MiB的文件，校验UTF-8、schema、文件摘要、语义回放结果与展示一致性。记录生产者和当前分析器源码摘要；源码变化不直接当作同版运行证明。规则变化导致逐版发布摘要不匹配时拒绝，需要显式迁移，不覆盖旧结果。

这验证了JSON持久材料可被新进程重建，不是已部署的正式修订服务。当前正式报告和内部工作流仍保留原始轮次，未新增审批登录、版本选择提交、正式修订落库、报告重发布或自动模型再生成路由。业务端接管认证、CAS保存和明确发布后才能对外使用。示例清单也无签名，不是可信审批凭证。
