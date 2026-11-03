# Agent候选提交适配与CAS联调

业务API可从@interview/agent-client导入createWorkflowCommitTicket、prepareWorkflowCommit、workflowCommitDigest与WorkflowCommitError。它们仅依赖共享contracts、Zod和Node crypto，不导入Pi、Agent服务或数据库。当前只处理workflow的create/plan/answer/finish/restore；turn/report/rsi明确拒绝，不自动发布策略。

prepare只返回未提交事务计划或已保存回执的精确重放，committed=false。正式API路由依然按现有边界返回501；本模块没有数据库连接、迁移、事务提交或学生鉴权。实验store的applied-in-memory不是生产提交。

## 数据与校验入口

API先完成用户认证，加载受保护任务、原请求、会话行和已存在的画像行，再调用helper。首次空画像也应由API建立明确的version=0状态；create请求必须显式传config.memory，不能用省略字段掩盖历史画像。

| 输入 | API责任与helper检查 |
| --- | --- |
| identity | API认证后的userId/roleId，不能直接信任学生提交的身份字段 |
| request | API保存的AgentRunRequest；冻结全部输入和root context，创建摘要，不只保存可任意替换的inputSnapshotId |
| ticket | operationId/taskId、用户/岗位/会话、run/attempt/inputSnapshotId、请求摘要、预期存储/画像/语义版本、leaseVersion与时间/status |
| run | SDK读取的终态快照；必须completed、stage/error为空、result为对应action的uncommitted-workflow-result，不接受202/SSE自行拼装 |
| current | 当前会话存储行{storageVersion,workflow}或null，以及API拥有的画像；必须属于相同用户/岗位/会话 |
| receipt | 同用户/岗位/会话与operationId的已保存回执，或null；必须来自API可信存储 |
| now | API可信毫秒时间；新提交须早于任务leaseUntil和deadlineAt |

createWorkflowCommitTicket只从已认证宿主输入构造票据，不分配持久任务、不获得租约、不认证学生。票据、请求、当前状态和receipt都不是模型可传的工具参数，也不能从renderer收取后直接使用。

共享真值见packages/contracts/src/workflow-commit.ts；[生成Schema](workflow-commit-schemas.json)只描述结构，helper另检查关系与连续性。hash为规范化JSON摘要，不是签名，无法证明服务、输入或回执来源。

## 版本与任务尝试

| 版本 | 含义 |
| --- | --- |
| storageVersion | API会话行的CAS版本；新操作每次推进，包括语义无变化的restore/重复finish，避免ABA或并发覆盖 |
| workflow.revision | Agent会话动作修订；正常动作递增，精确finish重试和restore可能保持 |
| state.version | 本场评分观察数量，不等于前两者 |
| memory.version | 用户/岗位历史画像版本；新收尾追加一场时递增 |
| leaseVersion + attemptId | API任务持有者fence和执行尝试，撤销或换尝试后旧准备计划不得写入 |

票据的expectedStorageVersion=null表示create时会话行应不存在，写入初始storageVersion=0。此后CAS匹配原版本再写+1。新finish需当前画像与会话baseMemory完全相同并匹配版本；画像被另一场更新时整包拒绝，不能提交会话后丢掉画像。

每次重新取得任务租约必须轮换attemptId并推进leaseVersion，保留冻结业务输入；不要复用旧attempt为新租约背书。Agent信封没有leaseVersion，stateless helper无法识别宿主非法复用同attempt的租约；API任务生命周期必须保证唯一性。fixture的replaceAttempt会拒绝相同attempt和变更业务内容。

## 动作连续性

- create：比对明确画像、初始状态/历史证据、策略、技能/目标与空问答序列。
- plan：既有状态/历史/画像不变，只追加发题记录或进入收尾。问题/rubric必须属于可信岗位和会话技能，plan技能一致，选中内容、量规与来源必须等于实际工具回执条目；草案仍需宿主允许。不是重新运行规划或最近难度排名，也不认证知识条目真伪。
- answer：追加且只追加一轮，输入严格绑定已发题、量规、回答、context、证据类型；检查原文引用、逐维分数归一化与总分算术，再核对新观察/状态更新和下一阶段。字面证据通过不是语义评分质量证明。
- finish：原有回答/状态不变，报告assessment逐项对应已保存轮次，收尾身份/来源/时间/版本一致。report、reflection、反思候选及追加画像的证据标签从原轮次和历史证据聚合，不能把offline升级live；语音逐回答资料与来源也绑定原输入。
- restore或已完成会话的合法finish重试：候选必须与源快照完全相同，不再追加画像；作为新业务operation时仍推进storageVersion及保存receipt。

此处不重跑完整报告的技能估计/推荐、反思指标/策略候选算法，也不验证ASR声学算法或服务/知识来源认证。Agent本身的恢复/报告校验仍要执行；后端可另行做独立恢复核验，但不能把本helper当成完整模型/报告正确性认证。

## 事务计划与精确重放

无receipt时，先校验任务活跃/租约、当前存储版本和源快照，再返回：

| 输出 | 含义 |
| --- | --- |
| where | task/run/attempt/input绑定、fence、租约/截止、预期storageVersion与源快照摘要、必要memory版本/摘要 |
| sessionWrite | 下一个存储版本及完整候选Workflow，closeout中的报告/反思也在同包 |
| memoryWrite | 首次有回答收尾时的画像追加候选，否则null |
| receiptCandidate | 业务operation、源请求/候选摘要、存储/画像前后版本；appliedAt须由API提交时替换为实际时间 |

有可信receipt时先核对身份和精确请求/候选摘要，再返回workflow-commit-replay；可以在租约过期或当前会话/画像已前进后确认原操作，不再检查旧源版本或发起写入。同operationId不同内容冲突，不能用旧回执覆盖新结果。只有已持久保存的回执才能这样确认，客户端收到run.completed不构成回执。

operationId在用户/岗位/会话范围内唯一，并对应一份冻结请求/候选；不要为网络重试随手换ID、时间、输入引用或结果。新attempt发生在提交前；若原操作已保存receipt，先返回原业务结果，不把另一候选覆盖它。

## 业务API事务适配要求

prepare不是事务或锁。后端应在单一事务中加载受保护行/receipt并验证，或在最终写入时原子重查所有where条件：

1. task仍running、leaseVersion和run/attempt/input/requestDigest匹配，未取消、租约/截止未过期。
2. 会话不存在或CAS匹配storageVersion；不得绕过用户/岗位/会话归属条件。所有会话写路径都必须推进存储版本。
3. 需要画像写时CAS匹配memory.version及原内容；create的画像输入也需在最终提交时匹配，防止创建计算期间丢失刚更新的历史。
4. 会话（含报告/反思）、必要画像、唯一receipt与任务committed状态同事务完成。任一条件影响0行或唯一键冲突均整体回滚；不要分开提交。
5. 精确receipt重放返回已保存结果；prepared计划若在网络等待外先生成，仍须在事务内复核。不能用JSON摘要冒充可信授权。

这是一份适配协议，不是已经实现/验证的SQL。现有db/schema.ts没有完整画像/receipt和fence字段/迁移，业务后端需自行映射存储行、约束、锁顺序、时间源、事务及重启恢复。不同实例/进程不能共用这里的内存fixture当正式仓库。

## 运行与已验证边界

```powershell
bun run agent:commit:demo
```

默认本机TCP，随机服务令牌和端口，真实SDK HTTP/SSE调用离线Agent。两岗演示8主操作与额外同快照竞争：revision=0/1/2/3/4/5/5/5，storageVersion=0/1/2/3/4/5/6/7；两个计算成功的plan只接受一份；旧create回执精确重放，画像仅追加一次。工具SSE仍committed=false，演练输出scope=offline-cas-fixture/formalCommitted=false/liveModelCalls=0。

runWorkflowCommitDemo(role,'in-process')用于无端口教程，不能称为TCP验证。tests还覆盖取消/fence/过期、篡改、画像冲突及提交前故障零部分内存写。后者只是同步状态交换演练，不证明PostgreSQL事务回滚、跨实例锁、生产租约时钟或正式业务已交付。
