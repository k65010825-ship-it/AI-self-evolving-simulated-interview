---
name: pi-agent-development
description: Use when integrating or debugging Pi Agent SDK in a TypeScript service, including custom tools, resource isolation, streamed events, cancellation, or SDK session restoration. Applies to Pi SDK work, not general interview product design or Claude SDK integration.
---

# Pi Agent SDK 开发

以已安装发布包的实际导出和类型为准，将 Pi 会话与产品会话、业务状态及前端事件分开。

## 证据入口

当前验证基线：`@earendil-works/pi-coding-agent@1.4.0`、`@earendil-works/pi-ai@1.4.0`、Bun 1.4.4。固定上游标签和源码索引见 [source-map.md](references/source-map.md)。升级前重新核对，不把 GitHub main 的签名当成发布包保证。

按问题读取：

- 创建、凭证与资源隔离、工具参数：读 [sdk-reference.md](references/sdk-reference.md)。
- 事件、取消、历史恢复：同一参考的“生命周期与恢复”。
- 可运行示例：项目根目录 `experiments/pi-sdk/offline-spike.ts`，执行 `bun run pi:offline`；验证范围见 [validation.md](references/validation.md)。

## 接入边界

1. 先读 `node_modules/@earendil-works/pi-coding-agent/{docs/sdk.md,dist/index.d.ts}` 与实际涉及的示例/声明。1.4.0 根入口不导出 `AuthStorage`；不要从内部文件路径绕开 exports。可通过公开 `CredentialStore` 接口显式提供存储，见参考。
2. `createAgentSession()` 默认包含资源发现与编码工具。托管业务服务须显式设置 resourceLoader、settingsManager、sessionManager、modelRuntime、cwd/agentDir 和工具名称白名单。空内存凭证仓库不等于禁用环境凭证；运行进程的环境也要由宿主管理。
3. `tools` 是名称数组，`customTools` 才是 ToolDefinition；SDK 参数用当前 `typebox`。公共契约使用 Zod 时，在执行边界再次校验，避免只信模型或供应商参数验证。
4. 每个业务 run 使用独立会话/上下文；工具授权与预算来自宿主注入，不能接受模型传入的 userId、权限或任意 URL/path。持久业务提交交给应用层，SDK 历史不提供业务恰好一次保证。
5. 先订阅再 prompt，结束后取消订阅并 dispose。`agent_end` 不是最终成功；`agent_settled` 只表明停止自动继续，还需检查 aborted、错误和最终输出校验。取消必须撤销业务结果提交资格。
6. 保持项目归一事件契约；不把 SDK 全量事件、思维内容、凭证或内部错误原文推给用户。

## 验证与常见误判

- 用本地确定性 provider 跑真实 SDK 工具循环、取消和历史恢复，明确标记模拟 provider；这不证明真实模型会选工具、回答正确或网络取消成功。
- `SessionManager` 管理上下文历史；不要直接赋值 `session.agent.state.messages` 伪造恢复。跨用户恢复先核对所有权，运行重试仍需业务幂等。
- 只有显式授权真实模型调用后，才测试供应商鉴权、结构化输出质量、token/费用和网络流；本 Skill 不授予付费调用、安装全局配置或部署权限。
- 本项目默认仅公开声明实现的能力，健康接口成功不等于面试/ASR/RSI 已实现。
