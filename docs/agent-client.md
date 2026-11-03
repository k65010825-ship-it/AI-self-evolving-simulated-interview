# 后端Agent客户端SDK

## 范围与安装

`@interview/agent-client`是仓库内私有workspace包，供业务API服务调用Agent。执行`bun install --frozen-lockfile --ignore-scripts`后可按包名导入；不发布npm、不读环境凭证、不依赖Pi或数据库。服务地址/token由可信宿主显式注入，禁止传给Electron renderer。

`bun run agent:client:demo`使用SDK经本机TCP完成两岗位五类workflow操作、原收尾命令重试和恢复；真实SDK后端仍使用本地手工provider，真实模型/ASR调用0。它证明SDK/HTTP/SSE联通，不证明教学质量或业务数据库提交。

## 接入示例

```typescript
import { createAgentClient, AgentClientError } from '@interview/agent-client';

// 由业务API配置模块传入，不能把token注入浏览器。
const client = createAgentClient({ baseUrl: agentOrigin, internalToken: serviceToken });
try {
  const run = await client.executeRun(trustedRunRequest, { timeoutMs: 30000, signal });
  if (run.result?.kind === 'uncommitted-workflow-result') {
    const candidate = run.result.snapshot;
    // API核对任务租约/身份/输入引用，再用原revision做CAS。
  }
} catch (error) {
  if (error instanceof AgentClientError) {
    // 记录code/status/requestId；不盲目重发会产生模型调用的写请求。
  } else {
    throw error;
  }
}
```

上例的配置、signal和trustedRunRequest均由宿主提供；可运行示例见scripts/demo-agent-client.ts、demo-workflow-http.ts。baseUrl仅支持http/https根origin，不允许userinfo/path/query/hash；真实部署的TLS/私网由部署方负责。SDK固定redirect:error，避免把内部token跟随到其他地址；不能替代代理和网络策略。

## 方法

| 方法 | 返回与约定 |
| --- | --- |
| startRun(request,options?) | 接受快照，绝不等价于成功或提交；不自动重试POST |
| getRun(runId,{attemptId?,signal?}) | 校验后的运行快照；如指定attempt必须匹配 |
| cancelRun(runId,attemptId,options?) | 显式远程取消；不撤回已完成候选或已发生业务事务 |
| events(runId,{attemptId,...}) | AsyncGenerator，产品事件验证、去重、有限断线续订 |
| waitForRun(runId,{attemptId,...}) | 查询初始快照，必要时订阅，终态再读快照；失败/取消抛AgentClientError |
| executeRun(request,options?) | 验证全部选项后start+wait，检查结果kind/输入引用/工作流action；总预算包括POST接受阶段 |

请求/快照/事件类型和运行校验来自公共contracts。客户端关联runId、attemptId、inputSnapshotId，验证SSE终态与最终快照相符；结果仍为未提交候选，业务API负责权限、持久任务、幂等与会话/记忆CAS。SDK没有学生登录、会话锁或正式写入。

SDK另导出createWorkflowCommitTicket和prepareWorkflowCommit，供API以可信任务/current状态检查workflow候选并生成未提交CAS计划；不接数据库，不替API完成事务。动作连续性、receipt重放顺序、存储与语义版本区分见[提交适配](workflow-commit.md)。

run/attempt路径标识限制1—1000字符，拒绝控制字符与`.`/`..`，按URL组件编码，不解释ID内容。JSON请求最多2MiB UTF-8，与服务保持一致；响应实际读取最多16MiB（可配置，最高32MiB）。响应体不是可执行对象，必须通过schema及关联校验。

## SSE与重连

支持UTF-8跨chunk、LF/CRLF/CR、注释心跳及多行data，单帧默认64KiB（最高1MiB）。必须有合法id/event/data，JSON类型、信封seq、run/attempt与事件名一致；seq必须连续。重放重复不重复yield，同seq内容冲突或缺号直接PROTOCOL_ERROR，不猜测缺失事件。

默认最多2次重连、间隔100ms，初始afterSeq=0；重连使用最近已验证并交付的seq作为Last-Event-ID。不持久保存cursor，业务方需自行保存后传afterSeq。网络中断、无终态EOF和单次读取空闲超时可有限重连；认证、业务HTTP、schema或序列错误不盲重试。服务若重启丢失事件/任务，SDK不自动创建新任务或降低游标。

EOF时若GET确认任务已终态且lastEventSeq等于cursor，可正常结束空重放；终态快照落后cursor则拒绝PROTOCOL_ERROR，不静默回退。否则重连取剩余事件，绝不合成run.completed。events只提供事件，不将run.failed冒充成功；wait/execute会将失败终态转为错误。

停止迭代或本地AbortSignal只清理请求/订阅，**不会发送远程取消**。需要放弃模型任务须显式cancelRun，后端同时撤销正式提交资格。使用订阅流时应for-await或显式return，避免闲置生成器占用连接。

## 时间预算与失败

普通请求默认10秒（1—60000ms），覆盖响应体及schema处理；事件/wait/execute默认30秒（1—300000ms），单次读取空闲默认10秒。execute总预算从POST前开始，另受各普通请求预算限制。墙钟timer与performance.now检查共同防止即时重复数据饿死计时器。忽略abort的fetch仍会被外层拒绝，迟到Response会取消其body；不保证远程调用或收费已经停止。

AgentClientError.code是服务ErrorCode或CLIENT_VALIDATION/PROTOCOL_ERROR/NETWORK_ERROR/TIMEOUT/ABORTED。已识别的服务错误保留静态码、status、retryable和合格requestId，不抛出上游原detail、网络cause、URL或token。未知/损坏响应使用静态协议错误。HTTP失败与202之后的运行失败不同：后者没有失败HTTP status，也会由wait/execute抛出服务码。

写请求从不自动重试。TIMEOUT/NETWORK_ERROR可能发生在服务已经接受任务之后：先按原runId/attempt查询；需要重放时只能显式使用完全相同请求，不能顺手换now、输入引用或attempt。retryable表示调用方可评估恢复，不表示SDK会自动执行，也不代表业务提交幂等已实现。

## 测试边界

SDK测试含分片/重放/断线/空闲/连续重复流、错误静态化、请求体/响应预算、身份关联、取消和启动总预算。进程内Hono验证与真实本机TCP验证分开，教程选择进程内以适应沙箱；两岗命令和集成测试另运行本机TCP。

真实供应商、数据库事务、多实例恢复、GUI/麦克风/Windows安装、生产代理和真实教学质量仍未验证。服务当前32条内存记录/4活跃、2MiB请求限制不因客户端SDK而消失。


## 会话收尾后的 RSI 实验

内部 runs 新增 `job.type=rsi`，输入完整已收尾 Workflow 和实验快照，返回 `kind=uncommitted-workflow-rsi`。SDK 支持执行与安全事件订阅；SSE 只输出合成聚合指标。离线实验可激活、拒绝或重放，原会话策略不变；下一场 pin 仅预览、未写正式库。来源校验、隔离规则、回滚重放及接口字段见 [会话收尾与 RSI 离线实验](workflow-rsi.md)。
