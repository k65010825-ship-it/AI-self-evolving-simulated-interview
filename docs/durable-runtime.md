# 持久任务与预算对账恢复

Agent可选操作存储已实现，使用Bun内置SQLite（WAL、synchronous=FULL、同步事务）。保存任务输入/候选结果、归一事件与预算checkpoint；不替API提交正式会话、画像或策略，不提供学生认证，无新的公开业务成功路由。

## 启用

live-service设置AGENT_DURABLE_DB_PATH为运营方控制的本机SQLite路径，启动入口创建durable manager；留空沿用内存manager，其他模式不接受该设置。.env.example默认留空，现有密钥文件不自动改写。模型调用仍受原授权/凭证/预算限制。

createDurableLiveRunManager(config,deps,{path,ownerId,leaseMs?})支持注入HTTP/时钟。启动入口每进程随机ownerId；lease默认模型timeout+1秒，最大120秒。路径不接受模型/renderer输入。DB和WAL含任务原文及候选，需API控制访问、保留与删除，不能整文件交给学生。

## 写入与幂等

1. 请求按runId及规范摘要唯一登记queued；相同请求幂等，改参数/attempt冲突。
2. 事务claim为running并增加fence，绑定owner/lease。queued可在显式start时启动，不扫描后自动发付费请求。

   同一profile及临时authorization摘要对应的maxRuns也在claim事务中累计，跨重启不重置；精确旧结果重放不消耗新次数。额度用尽拒绝新claim。修改授权配置仍属于运营方授权行为，不能由模型或客户端刷新。
3. reserve/dispatch同步落盘后才派发HTTP；账本写失败停止。dispatched只表示可能已发送，不能当作供应商已接收或零费用。
4. snapshot与单条event同事务保存，成功后才发布内存事件；失败撤销结果并唤醒订阅，不泄露未落盘run.completed。
5. 预算/事件写入及派发前复核owner/fence/lease；旧owner不能覆盖恢复状态。SQLite保存时钟高水位，跨重启回退拒绝。

终态结果和afterSeq事件可重放，无需凭证或模型。当前进程使用实时SSE，重开后读保存事件；没有跨进程事件推送总线。内部完成仍是候选，不等于正式业务事务成功。

## 中断恢复

其他owner的lease未到期不强行接管。lease过期后running变interrupted并保存静态失败snapshot/event；dispatched转unknown，尚未派发的reserved释放预留，rejected保留最坏费用。已失败/取消等终态遗留dispatched也会在过期后转unknown。

interrupted不自动恢复SDK执行位置或重发模型，精确start返回保存的失败结果。API检查业务状态、usage和幂等键后，才能明确创建新任务。retryable字段不授予自动重发权限。hash不证明身份或供应商计费真实性。

当前是保守的实例级阻断：unknown/locked，以及尚未确认结束的dispatched，阻止新付费派发。SQLite是阻断真值，对账后同进程可接纳新任务。这是容量取舍，不是每用户配额或跨机总限额。

## 账本与对账

gate.restore检查profile/scope、callId唯一、预留/费用/超用与汇总。存储把scope身份哈希、岗位及期限绑定原任务。snapshot中旧accounting字面值描述算账/声明费率来源；持久载体由外层storage=sqlite-wal-full标明，均非供应商账单。

reconcile仅供受信API调用，没有HTTP管理接口。机器真值见[durable-runtime-schemas.json](durable-runtime-schemas.json)：runId/attemptId/identity、callId、expectedVersion、完整usage和evidenceRef。身份来自认证上下文，用量依据由运营方保存，不能用模型自报替代。

只允许对非活动任务的unknown/rejected对账；事务核对版本后保存usage及唯一回执。同usage/依据重试返回原receipt，即使版本推进；不同声明冲突。原声明费率与reportedCost保守取值，超用完整入账后继续锁定。authority明确为host-supplied-usage-not-vendor-verified。对账只解除占用，不重新激活旧任务。

## 验证

bun run agent:durable:demo执行两岗注入传输失败→关闭/重开真实SQLite→无密钥无HTTP重放→合成usage对账→同进程新任务成功，在.cache保留DB供检查。

回归另创建真实Bun子进程，在dispatch记录后process.exit(23)，未运行manager清理；父进程推进lease时钟、重开同一DB，验证unknown/零重发/对账幂等。SQLite触发器拒绝预算插入时HTTP=0；还覆盖事件发布失败、fence、身份/版本/usage冲突。

这是本机退出/文件重开与注入故障证据，不证明停电/磁盘损坏恢复、网络文件系统/多机调度、生产负载、真实费用、正式业务事务或GUI。初版尚无历史迁移、自动清理或跨主机总线。

## 任务终态与迟到记账

checkpointRun在SQLite事务内冻结completed/failed/cancelled结果和事件；持有原owner/fence也不能使终态重新运行。checkpointBudget保持独立：有效租约/身份/版本下可结清已派发usage，但不能改任务结果；租约失效后两类旧owner写入都拒绝，由受控对账处理unknown。未派发reserved在过期恢复时释放，已派发dispatched转unknown保留预留。完整决策与验收入口见[统一恢复决策](model-recovery.md#运行状态与持久写入的恢复决策)。

业务里程碑（workflow.updated、rsi.completed及规划的question.completed）发布期间，Agent任务仍保持running；仅最终run.completed同时封存completed快照与结果，避免终态防护拦住后续正常事件。不能在业务里程碑时提前把整个任务标记completed；API提交仍需等待完整终态并执行自身CAS。回归：tests/durable-terminal-publication.test.ts，使用真实SQLite的无模型workflow create。
