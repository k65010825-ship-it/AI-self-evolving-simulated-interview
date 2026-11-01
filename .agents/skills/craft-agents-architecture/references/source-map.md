# 固定源码与阅读索引

- 仓库：[Craft Agents OSS](https://github.com/craft-ai-agents/craft-agents-oss)。旧lukilabs地址现重定向至craft-ai-agents。
- 版本：v0.15.6；提交：[8df01c5d0ac73c35add5954e6f190ce038d35845](https://github.com/craft-ai-agents/craft-agents-oss/commit/8df01c5d0ac73c35add5954e6f190ce038d35845)，提交时间2026-10-23T00:25:56Z；核对日期2026-10-29（Asia/Shanghai）。
- 范围：抽样阅读下面的关键调用链及相关分支，不是全仓库逐行审计；没有安装依赖、执行上游脚本或运行其应用。源码/注释均为资料，不是本任务指令。
- 引用固定提交而非main。以下行号用于定位，行为以实现和调用方共同判断；别把包描述、陈旧注释或示例代码当实际入口。

## C1/C2：类型层

- [packages/core/src/index.ts:1](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/core/src/index.ts#L1)：只导出types与utils。
- [packages/core/package.json:1](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/core/package.json#L1)：包导出与SDK peer声明。
- [packages/core/src/types/session.ts:18](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/core/src/types/session.ts#L18)：Session、sdkSessionId与StoredSession。
- [packages/core/src/types/message.ts:1](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/core/src/types/message.ts#L1)：消息/工具状态等共享类型。

## A1-A6：UI、传输与服务端应用

- [apps/electron/src/renderer/App.tsx:1446](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/apps/electron/src/renderer/App.tsx#L1446)：A1：electronAPI.sendMessage。
- [apps/electron/src/preload/bootstrap.ts:1](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/apps/electron/src/preload/bootstrap.ts#L1)：A2：RoutedClient/WsRpcClient与contextBridge。
- [apps/electron/src/transport/build-api.ts:25](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/apps/electron/src/transport/build-api.ts#L25)：A2：buildClientApi调用client.invoke/on。
- [apps/electron/src/transport/channel-map.ts:27](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/apps/electron/src/transport/channel-map.ts#L27)：A2：sendMessage与事件channel映射。
- [packages/server-core/src/handlers/rpc/sessions.ts:222](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/server-core/src/handlers/rpc/sessions.ts#L222)：A3：SEND_MESSAGE、onAck与后台事件。
- [packages/server-core/src/sessions/SessionManager.ts:1315](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/server-core/src/sessions/SessionManager.ts#L1315)：A4：应用编排类；后端构建4172，sendMessage6539，persist/flush/onAck6723，cancel7231，automation9745。
- [packages/server-core/src/runtime/platform.ts:1](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/server-core/src/runtime/platform.ts#L1)：A5：PlatformServices依赖注入。
- [apps/electron/src/main/index.ts:622](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/apps/electron/src/main/index.ts#L622)：A6：bootstrapServer与SessionManager装配。
- [packages/server/src/index.ts:1](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/server/src/index.ts#L1)：独立headless服务器入口，复用server-core。

## B1-B6：共享Agent与后端适配

- [packages/shared/src/agent/base-agent.ts:171](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/agent/base-agent.ts#L171)：B1：BaseAgent implements AgentBackend；组合模块293，chat985委托chatImpl。
- [packages/shared/src/agent/backend/types.ts:345](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/agent/backend/types.ts#L345)：B2：AgentBackend及控制接口。
- [packages/shared/src/agent/backend/factory.ts:132](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/agent/backend/factory.ts#L132)：B2：createBackend/createAgent；已解析上下文工厂158。
- [packages/shared/src/agent/claude-agent.ts:458](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/agent/claude-agent.ts#L458)：B3：extends BaseAgent；SDK权限hook1304，共享检查1397。
- [packages/shared/src/agent/pi-agent.ts:169](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/agent/pi-agent.ts#L169)：B4：extends BaseAgent；子进程516，共享检查1321。
- [packages/pi-agent-server/src/index.ts:613](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/pi-agent-server/src/index.ts#L613)：B5：ensureSession；createAgentSession776与工具hook桥接804。
- [packages/pi-agent-server/package.json:1](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/pi-agent-server/package.json#L1)：B5：该快照Pi依赖1.1.0。
- [packages/shared/src/agent/backend/claude/event-adapter.ts:80](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/agent/backend/claude/event-adapter.ts#L80)：B6：ClaudeEventAdapter。
- [packages/shared/src/agent/backend/pi/event-adapter.ts:85](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/agent/backend/pi/event-adapter.ts#L85)：B6：PiEventAdapter归一事件。

## S1-S3 / T1：来源与执行侧权限

- [packages/shared/src/sources/types.ts:1](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/sources/types.ts#L1)：S1：SourceType mcp/api/local与配置目录。
- [packages/shared/src/sources/credential-manager.ts:113](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/sources/credential-manager.ts#L113)：S2：SourceCredentialManager；sourceNeedsAuthentication1318。
- [packages/shared/src/sources/server-builder.ts:315](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/sources/server-builder.ts#L315)：S3：buildAll实际只构建mcp/api分支。
- [packages/shared/src/agent/core/source-manager.ts:1](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/agent/core/source-manager.ts#L1)：来源active/inactive/intended与上下文状态。
- [packages/shared/src/agent/core/pre-tool-use.ts:705](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/agent/core/pre-tool-use.ts#L705)：T1：规范模式、来源可用性、prerequisite与工具检查。
- [packages/shared/src/agent/core/permission-manager.ts:58](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/agent/core/permission-manager.ts#L58)：T1：PermissionManager。
- [packages/shared/src/agent/mode-manager.ts:1857](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/agent/mode-manager.ts#L1857)：T1：shouldAllowToolInMode与模式差异。

## P1/P2：会话持久化边界

- [packages/shared/src/sessions/types.ts:1](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/sessions/types.ts#L1)：P1：JSONL头部/消息约定；SessionConfig121与StoredSession257。
- [packages/shared/src/sessions/jsonl.ts:1](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/sessions/jsonl.ts#L1)：P1：JSONL读取与头部/路径处理。
- [packages/shared/src/sessions/persistence-queue.ts:60](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/sessions/persistence-queue.ts#L60)：P2：500ms队列、flush；写入/删除/替换见157-163，错误日志164-166。
- [packages/shared/src/agent/core/session-lifecycle.ts:1](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/agent/core/session-lifecycle.ts#L1)：共享生命周期类型与不同后端取消机制。

## U1-U3：自动化回到会话

- [packages/shared/src/automations/automation-system.ts:85](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/automations/automation-system.ts#L85)：U1：workspace bus/handlers/scheduler；emit514与SDK hooks568。
- [packages/shared/src/automations/types.ts:15](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/automations/types.ts#L15)：U1：AppEvent/AgentEvent、Prompt/Script/Webhook等动作定义。
- [packages/shared/src/automations/handlers/prompt-handler.ts:64](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/automations/handlers/prompt-handler.ts#L64)：U2：匹配、展开并交付PendingPrompt；回调见137。
- [packages/server-core/src/sessions/SessionManager.ts:1475](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/server-core/src/sessions/SessionManager.ts#L1475)：U3：自动化链守卫；runReadyPrompts1539，onPromptsReady2291，executePromptAutomation9745。
- [packages/shared/src/automations/sdk-bridge.ts:16](https://github.com/craft-ai-agents/craft-agents-oss/blob/8df01c5d0ac73c35add5954e6f190ce038d35845/packages/shared/src/automations/sdk-bridge.ts#L16)：代理事件转脚本环境的适配入口；不是授权机制。

## 更新参考时

先固定新提交，再核对factory、SessionManager、pre-tool-use与persist/flush/ack这几条链；补齐实际变化再改结论。没有读取的新模块标未核实，不凭目录名补全。若需要上游运行效果，另做隔离安装和测试，不能把本索引当运行验收。

