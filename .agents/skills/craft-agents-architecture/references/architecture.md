# 分层与主链路

适用快照和证据编号见[源码索引](source-map.md)。下文“原因”是基于依赖关系的架构解释，不冒充作者公开动机。

## 职责与取舍

| 层 | 快照事实与入口 | 为什么有这一层 | 成本与迁移判断 |
| --- | --- | --- | --- |
| 共享契约 | core导出types/utils；会话、消息、事件供多端使用（C1/C2） | UI、服务与后端对同一对象和事件达成约定，减少SDK形状向外扩散 | 类型不是运行时校验；包里有SDK peer声明，不能宣称物理依赖绝对纯净。小项目可先用独立模块 |
| 共享业务与Agent公共逻辑 | shared中的sources/sessions/automations；BaseAgent组合权限、来源、提示词、用量、前置条件（B1） | 多个后端共享同一产品语义，避免每个SDK重写来源状态与权限规则 | shared容易变成杂物层；不要复制全部类，先找实际共用职责 |
| 服务端应用编排 | server-core的SessionManager、RPC handlers、PlatformServices（A3/A4/A5） | 会话归属、消息排队、后端生命周期、事件推送由可信运行端管理；Electron/headless通过平台注入复用 | SessionManager很大，不是理想小类样板；学职责与边界，不照抄集中度 |
| 后端选择与适配 | AgentBackend、工厂、driver registry、ClaudeAgent/PiAgent、事件adapter（B2-B6） | 连接/模型配置与宿主环境解析后，统一向产品交付chat事件和控制接口 | 各SDK停止/steer/resume/工具语义仍需单独适配；多后端不是免费的 |
| 平台与展示 | Electron main注入平台并bootstrap；preload构造API；React消费事件（A1/A2/A6） | 隔离桌面能力与业务编排，支持本地/远程服务路由 | RPC、进程、打包与鉴权成本真实存在；普通网页产品不必加桌面壳 |

## 发送一条消息

固定快照中可追踪的链路：

`renderer/App.tsx → window.electronAPI.sendMessage → buildClientApi / CHANNEL_MAP → RpcClient.invoke → registerSessionsHandlers(SEND_MESSAGE) → SessionManager.sendMessage → backend.chat → 统一事件 → 会话/推送/renderer`

- UI调用见A1；API代理和channel映射见A2；handler见A3。
- preload正常模式用RoutedClient，薄客户端模式用WsRpcClient（A2）；不能把当前完整链路说成仅Electron IPC。启动/本地OS操作仍有Electron专用桥接。
- handler使用onAck返回accepted，模型流在后续事件中交付。SessionManager在正常新增消息路径调用persistSession、flushSession再onAck（A4）。这是设计意图及调用顺序，不是经过故障注入的持久化成功保证；存储边界见运行参考。
- SessionManager通过createBackendFromResolvedContext装配配置，再消费AgentBackend事件；工厂也保留createBackend/createAgent入口。不要误把库的演示入口当成所有真实调用路径。

## Claude与Pi共享什么、分开什么

1. **共享产品契约。** AgentBackend定义chat、abort/forceAbort、可选stopTurn、redirect及会话/来源/权限接口（B2）。公共BaseAgent实现chat前置逻辑并委托chatImpl。
2. **共享规则。** BaseAgent组合PermissionManager、SourceManager、PromptBuilder等。两个实现都extends BaseAgent；不要被factory/index内“implements directly”的旧注释误导。
3. **保留SDK差异。** ClaudeAgent接Claude Agent SDK的PreToolUse等hooks；PiAgent启动pi-agent-server子进程，JSONL通信。服务进程通过createAgentSession建立Pi会话（B4/B5）。
4. **事件归一。** ClaudeEventAdapter/PiEventAdapter把不同SDK事件映射到Craft事件，不要求UI理解SDK原始消息（B6）。归一不代表所有能力与时序相同。
5. **区分后端和模型提供方。** 工厂的后端族是anthropic/pi；Pi后端还可承载不同模型提供方。它不是“只有Claude模型与Pi模型”的二选一。

此快照的pi-agent-server声明Pi相关依赖1.1.0，观澜使用1.4.0。借鉴hooks、取消或消息接口前，核对本项目安装包声明及实现，不能直接搬旧版本代码。

## 用于架构讨论时

解释抽象的价值要附一个具体变化：例如新增provider只改变后端工厂/适配，取消语义在应用与后端控制接口之间定义，工具权限规则两后端共用。再说明代价：抽象接口需要版本维护，SDK能力差异需要显式暴露，不能用大量可选方法假装完全兼容。
