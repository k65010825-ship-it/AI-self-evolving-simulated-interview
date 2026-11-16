# Pilot 的持久会话预算运行入口

`createPilotAgentRuntime` 将 API 已建立的会话账本接到 `createDurableLiveRunManager` 的真实 LLM HTTP 尝试前检查点。构造不读取凭证；测试传入合成凭证与本地 SSE Response，没有供应商网络请求。

```ts
import {createPilotAgentRuntime} from '../apps/agent/src/runtime/pilot-runtime.ts';
const runtime = createPilotAgentRuntime({
  path:'./data/pilot-runs.sqlite',
  bindingsPath:'./data/pilot-run-bindings.sqlite',
  ledger, liveConfig,
  readCredential: name => projectCredentialResolver(name),
});
// ledger由API的onSession先ensureSession，不能由模型或运行入口自行建立或放宽额度。
runtime.start(workflowRequest);
await runtime.wait(workflowRequest.context.runId);
const result = runtime.snapshot(workflowRequest.context.runId);
runtime.close(); // 关闭自身run store与binding store；ledger由宿主最后关闭。
```

只接受 `job.type='workflow'`。create 从 `config.session.sessionId` 取业务会话，其余 action 从 `snapshot.state.sessionId` 取会话；业务 identity、外层 context、API ledger 的 userId/roleId 必须一致，币种必须与声明价格一致。绑定表保存真实业务标识和请求摘要，随后才启动 durable run；同一 runId 不能换请求、会话或学生。表不保存凭证、原始回答或模型伪名作为用户身份。

真实 provider 的每次 reserve/dispatch/usage 检查点先同步写入统一账本，再写旧的按 run 预算快照。统一账本准入失败则不能发送 HTTP。既有 forRun 单次 token、cost、calls、deadline 约束继续保留；会话级 canDispatchRun 在读凭证前检查锁定、unknown、截止时间、剩余成本/次数/并发，最后的跨进程竞争由 ledger.reserve 的 SQLite immediate 事务裁决。多个数据库不形成分布式事务：第一份检查点成功而第二份失败时保留额度，优先避免低估潜在成本。

重启后，已完成请求从 durable store 返回原结果，即使当前配置关闭 live 也不读凭证、不再收费。启动时按durable恢复后的unknown/released预算条目镜像统一ledger，包含interrupted以及保留cancelled/failed的终态任务。对应dispatched转unknown，明确released的未派发reserved可释放；不以任务终态代替账目状态。已 settled 费用不重新定价。缺失 durable budget 的异常条目保守保留，交宿主核查。SHA-256 映射只用于匹配按 run 的模型预算，不替代学生身份或 API 归属授权。

配置可以关闭以读取历史结果，新的付费执行仍须通过既有 live authorization。ASR/TTS 需要由宿主接同一个 ledger，不能因为此 LLM 包装器已存在就视为自动覆盖。旧 durable manager 的全局 unknown/overrun 阻断继续存在，可能保守阻止其他会话乃至无付费动作；本模块没有绕过其原保护。导入账单需要同时处理旧按 run 预算与统一会话账本的未知记录；仅清除其中一个不会自动解除另一份保留。

专项：`bun test tests/pilot-runtime.test.ts`。覆盖同会话两 run 只允许一次 HTTP、真实业务身份入账、关闭重开精确重放、变更请求/身份拒绝、缺 scope 零凭证读取、真实子进程 dispatch 后终止与租约恢复。它们是离线工程证据，不证明真实供应商使用、账单认证或正式 API 提交已完成。

当前 `apps/pilot/agent.ts` 已将LLM、ASR、TTS与独立表达调用接入统一ledger，API在创建正式会话时ensureSession。TTS过期running缓存转interrupted并保留unknown，不自动重放；旧表迁移保留缓存音频。详见[pilot运行](pilot.md)。
