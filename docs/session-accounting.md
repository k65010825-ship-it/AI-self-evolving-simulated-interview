# 会话统一费用账本

本模块是 Agent 运行记账，不是业务会话表，也不是供应商结算系统。API 宿主验证学生身份、业务 sessionId 和岗位后才调用。模型、renderer、任意 HTTP 请求不能直接指定策略或导入费用证据。

`packages/contracts/src/session-accounting.ts` 是数据契约；`apps/agent/src/accounting/session-ledger.ts` 使用 Bun SQLite；`checkpoint-adapter.ts` 桥接现有 LLM/ASR 检查点。所有写入使用 `BEGIN IMMEDIATE` 事务，WAL、FULL 同步和 busy timeout；独立连接及独立进程共享同一文件的限额。读取快照也在单个事务内完成。

## 宿主接入

```ts
import {openSessionAccounting} from '../apps/agent/src/accounting/session-ledger.ts';
import {createSessionCheckpointAdapter} from '../apps/agent/src/accounting/checkpoint-adapter.ts';

const ledger = openSessionAccounting('./data/session-accounting.sqlite');
const binding = {sessionId:'session-1',userId:'student-1',roleId:'java-backend',runId:'run-1'};
ledger.ensureSession({sessionId:binding.sessionId,userId:binding.userId,roleId:binding.roleId,
  currency:'CNY',maxCostMicros:1_000_000,maxCalls:20,maxConcurrent:2,deadlineAt:Date.now()+600_000});
const checkpoints = createSessionCheckpointAdapter({ledger,binding,
  pricing:{source:'project-config/asr-declared-per-request-ceiling',version:'2026-11-06',unit:'request'}});
// 在构造 ASR provider 时传 onCheckpoint: checkpoints.asr。
// LLM 使用独立 adapter，pricing 来源/版本写明对应 token rate profile，onCheckpoint: modelAdapter.model。
// provider 调 HTTP 前，必须让检查点回调同步完成；失败则禁止发请求。
```

同一业务 session 的每轮 LLM、ASR 和 TTS 都必须传相同 sessionId，使用新的、稳定可追溯的 runId。重复 `ensureSession` 只接受相同策略；用户、岗位、币种、限额及截止时间不能通过换一轮调用重置。新模块不会自动从旧的按 run 隔离快照推断业务 session。代码接入前已有请求不能被事后导入冒充“请求前已准入”。

API：`ensureSession(policy)`；`reserve(reservation)`；`dispatch(sessionId,attemptId)`；`markUnknown(sessionId,attemptId)`；`completeResponse(sessionId,attemptId)`；`release(sessionId,attemptId)`；`snapshot(sessionId)`；`recoverExpired(cutoff?)`；`reconcile(command)`；`close()`。同步方法均在返回前持久化。

TTS 或其他宿主 transport 可直接调用上述 reserve/dispatch：reservation 包含 sessionId、userId、roleId、operationId、attemptId、kind、reservedCostMicros、pricing。先 reserve，再 dispatch 并提交事务，最后发送 HTTP。一次实际 HTTP attempt 一条记录；重试也占调用数。`operationId` 是宿主幂等操作键，`attemptId` 是不可复用尝试键；同一 operation 只有从未 dispatch 的 released 尝试允许新 attempt，其他状态拒绝自动重放。adapter 用 kind + runId + provider callId 的 SHA-256 生成稳定键，避免重开后从 http-1/asr-1 自动重复发送。

## 状态及保留额度

| 状态 | 保留费用 | 占并发 | 处理 |
|---|---:|---:|---|
| reserved | 是 | 是 | 仅可 dispatch 或 release |
| dispatched | 是 | 是 | 已写预发送检查点，网络结果尚不确定 |
| unknown | 是 | 是 | 不自动重放，等待可信证据 |
| responded | 是 | 否 | 已观察 HTTP 响应，金额仍未知；允许后续不同操作 |
| released | 否 | 否 | 确认未 dispatch，调用名额仍计入 |
| settled | 否，以实际金额替代 | 否 | 已按宿主证据对账，记录原始保留额 |

未知金额不按 0 结算。ASR 的 responded/rejected 检查点仅证明获得响应，token usage 不等于货币金额；adapter 保留 per-call 声明上限并释放并发。网络 unknown 仍保留并发，避免未知请求与新请求超出真实并发限额。费用保留会耗尽预算，需导入真实费用资料后释放，不能因得到文本就自动退款。

到 session 截止时间，`recoverExpired()` 把 reserved 释放，把 dispatched 标 unknown；已有 responded 保持待对账。宿主也应在对应 run 取消/超时后调用 markUnknown。进程重开不释放尚未到期的在途记录；整个 session 的截止恢复是保守兜底。SQLite 提交与供应商收请求无法组成分布式原子事务：dispatch 后立刻崩溃即使未真正发包，也按 unknown 保留，宁可人工核查，不宣称恰好一次。

## 金额来源与导入

`pricing.source/version/unit` 必须说明供应商价格配置或项目声明上限的来源和版本。它是来源说明，不是认证。LLM adapter 接受既有预算器的完整 usage + 声明 rate 计算所得 actualCostMicros，生成 `host-usage` 证据及哈希；ASR/TTS 使用可靠 token rate、字符、音频时长或按次计费方式之前，应由宿主显式配置来源和单位。未提供货币价格规则时保留上限，不推测金额。

```ts
const current = ledger.snapshot('session-1');
const receipt = ledger.reconcile({sessionId:'session-1',attemptId:'known-attempt-id',
  expectedVersion:current.version,reconciliationId:'invoice-line-2026-11-1',actualCostMicros:3200,
  evidence:{kind:'host-imported-bill',reference:'private-bill:line-17',sha256:'a'.repeat(64)}});
```

对账仅允许 dispatched/unknown/responded。必须通过会话版本 CAS，stale version 拒绝且不改额度。相同 reconciliationId + attempt + 金额 + 证据重复导入返回原收据；改变内容或给同一 attempt 换导入键均拒绝。相同命令重放不要求保留旧 expectedVersion，因此客户端可以安全重试已成功但丢失响应的导入。

金额超过原保留上限，或账本总额超过会话预算时，完整记录实际金额并永久锁住后续准入；不裁剪成本，不自动提高预算，不自动解锁。费用证据的 reference/hash 是审计定位，模块不连接供应商核验哈希、账单归属、签名或税额。所有快照/收据的 authority 固定为 `host-supplied-not-vendor-verified`；传入 `vendor-verified` 类型会被 strict schema 拒绝。宿主导入属于受信管理操作，业务路由仍需认证、归属校验及账单条目与请求的人工/外部核查。

## 离线验证与边界

运行：`bun test tests/session-accounting.test.ts tests/session-accounting-adapter.test.ts`。覆盖独立连接、5 个 OS 进程竞争同一文件、跨 ASR/LLM/TTS 保留、关闭重开、未知网络保留/防重放、响应完成释放并发、CAS、重复/冲突对账、真实超额完整入账及锁定、ASR 与 LLM 检查点。

这些检查没有调用真实供应商、读取凭证或验证账单真实性；关闭重开是 SQLite 持久化验证，进程竞争是本机多进程验证，不等同多主数据库部署。账本文件、父目录、宿主时钟和管理调用由部署宿主保护；不承诺多机器网络文件系统锁，也不自动清除历史审计记录。本模块不负责正式会话归属表和费用支付。调用方必须确保每条付费传输都经过准入，TTS 浏览器本地 speechSynthesis 无付费供应商成本时也不得伪造供应商费用记录。
