# 会话收尾的修订预览

预览以已完成的会话和原始报告为基准，按选定反馈版本生成独立 `uncommitted-closeout-preview`。只替换预览报告的反馈文字与发布元数据；原始会话、分数、能力观测、量规练习计划、记忆候选和正式提交候选不变。

## 运行与契约

```powershell
bun --no-env-file run agent:closeout:preview:demo
```

示例通过真实本地 TCP/HTTP/SSE 执行两岗会话收尾预览，模型由离线固定 provider 构造源会话；预览本身不进入模型依赖工厂，不读凭证、不发供应商请求。输出 `.cache/closeout-preview/run-*/report.json` 是合成开发证据，含请求快照和预览全文，不代表学生数据、专家批准或正式报告。

使用现有内部接口 `POST /internal/v1/runs`，无需新业务路由：

```typescript
const request = {
  inputSnapshotId, context, // 来自已鉴权业务宿主，包含user/role/run/attempt/deadline
  job: { type: 'closeout-preview', input: {
    snapshot: completedWorkflow,
    expectedSnapshotDigest: closeoutSnapshotDigest(completedWorkflow),
    selections: [{ answerId, history, version: 1 }],
  } },
};
```

`history` 使用[反馈版本链](feedback-revision.md)。最多选择20个不同回答、每份历史最多20版；`version=0` 查看原始反馈，不移动历史头。空 selections 生成原始报告的只读预览。不接受未完成会话、未知/未评分回答、重复选择、超出头版本、错源历史或不匹配的快照摘要。

字段真值：`packages/contracts/src/closeout-preview.ts`；OpenAPI/runtime schemas与 `evaluation-schemas.json` 同步。输入仍受现有2MiB传输限制，不因预览放宽。

## 宿主权限与零模型路径

`RunManagerDependencies.previewEditorsFor(context)` 由宿主返回允许的编辑者ID列表，不能从请求/模型参数获得。`LiveModelDependencies` 也透传该回调；未配置时默认空列表，有编辑记录的历史会拒绝。该列表与内部服务token仅构成调用方的授权边界，预览不认证审核人，结果始终 `identityVerified=false`。

预览在现有运行队列中执行，支持超时、取消、幂等请求和SSE续订。该分支跳过 `forRun/evaluateForRole/planForRole/deliverForRole`，不创建模型预算账本或工具调用；已有服务启动授权、运行任务数上限及持久入口unknown门控仍按原规则执行。测试使用禁止触碰凭证/HTTP的依赖验证此路径，并不构成真实供应商验收。

`buildCloseoutPreview` 首先校验归属与快照摘要，然后用 `restoreInterviewWorkflow` 重验原始收尾（评分、报告、记忆与反思一致性）。对选中的历史逐版回放后，复制指定版本的过滤反馈及版本上下文；绝不直接复制未复核修订文本。未选择的回答保持原样，评分/量规卡/学习计划不变。内容报告生成时间保留原值，预览生成时间单独记录。

## 返回与展示边界

结果带有 `basedOn`：原快照和报告摘要、会话与状态版本、每个回答的历史摘要/头版本/选中版本/选中源和修订摘要；`report` 为独立报告投影。`readOnly=true`、`formalCommitted=false`、`qualityClaimEligible=false`、`liveModelCalls=0`。

报告增加 `feedback_revision_preview_not_formal_report` 提示，按新反馈重新计算暂缓提示。存在问题的条目仍会被过滤，所有自由文本仍为未验证草案。客户端 `executeRun` 校验结果种类、原报告摘要和版本选择绑定，不能用另一份报告或版本替换预览。

SSE只增加 `closeout_preview` 阶段和 `run.completed/resultKind=uncommitted-closeout-preview`，不推送反馈、原答或版本链全文；完整结果通过内部运行查询获得。`createWorkflowCommitTicket/prepareWorkflowCommit` 不支持预览任务，不能把它当作正式closeout提交。界面由队友实现，本模块不改桌面；调用方应明确标注“修订预览”，不要覆盖已保存原报告。

本模块没有提供正式版本选择落库、审批登录、学生侧发布或报告重发布能力，相关业务接口仍未实现；摘要验证也不是身份签名或评分质量认证。
