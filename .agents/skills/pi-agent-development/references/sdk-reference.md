# Pi 1.4.0 接口参考

## 会话与隔离

以项目可运行的 `experiments/pi-sdk/offline-spike.ts` 为完整例子。SDK 全量示例优先读安装包 `examples/sdk/12-full-control.ts`，再读 `dist/core/sdk.d.ts` 与 `dist/index.d.ts`，避免相信过时注释。

公开根入口有 createAgentSession、ModelRuntime、SessionManager、SettingsManager、createExtensionRuntime 和 ResourceLoader 类型，但没有 AuthStorage。旧代码中的 getModel 位于 pi-ai/compat；新代码优先从 ModelRuntime.getModel 查询，不额外引入全局模型注册。安装包 sdk.d.ts 自带 JSDoc 仍有 getModel 根导入与 continueSession 的旧示例；它们不是当前公开导出/选项，不能照搬注释代码。

可用的最小凭证接口来自 `@earendil-works/pi-ai` 的 CredentialStore：read、list、modify、delete，全部 async。离线只读仓库 read 返回 undefined、list 返回 []，写入抛错。生产凭证仓库是后续实现，不能复制“离线无凭证”对象当成已支持在线鉴权。

ModelRuntime.create 可显式传 credentials、modelsPath:null、allowModelNetwork:false、refreshOnCreate:false。它们避免默认文件配置和创建时目录刷新；不构成对一切运行时网络/环境访问的沙箱。环境由启动器筛选，服务端不继承客户端个人环境。

ResourceLoader 完整接口：getExtensions（含 createExtensionRuntime）、getSkills、getPrompts、getThemes、getAgentsFiles、getSystemPrompt、getSystemPromptSource、getAppendSystemPrompt、getAppendSystemPromptSources、extendResources、reload。空实现必须完整符合当前声明；仅设置 noExtensions 不代表其余资源已隔离。

SettingsManager.inMemory 明确关闭自动 retry/compaction，交给业务任务预算控制；若以后开启，纳入同一预算并测试恢复。SessionManager.inMemory(cwd) 不写 SDK 会话文件。业务数据库仍单独负责画像、报告和运行状态。

## 工具

创建参数：`tools: ['query_role_knowledge']` 加 `customTools: [definition]`。1.4.0 ToolDefinition 的 execute 参数依次为 toolCallId、params、signal、onUpdate、ctx。不要搬旧版签名，也不要把 Tool 对象放进 tools。

parameters 使用 `typebox` 的 schema。执行函数再次解析公共 Zod 输入，按注入 roleId/owner/runId 判断访问、检查 signal 和剩余调用预算，返回 content 与 details；声明 outputSchema 时同时提供符合 schema 的 structuredContent。

业务错误以结构化回执交给模型做有限恢复；无权限、预算耗尽、取消不得自动换工具绕过。query_role_knowledge 的生产数据契约见项目 docs/tool-contracts.md。

## 生命周期与恢复

- subscribe(listener) 返回取消订阅函数；message_update.text_delta 用于展示，message_end 包含最终消息。
- agent_end 带 willRetry；agent_settled 带 aborted。仅根据 settled=false/true 不能判断业务输出是否成功。
- abort() 与 waitForIdle() 可 await；dispose() 释放会话。工具自行遵循 AbortSignal，模型供应商是否已停止请求/计费需要在线验证。
- 恢复使用 SessionManager.open，或用有效 header+SessionEntry 经 SessionManager.inMemory(cwd, options, entries) 恢复；buildSessionContext 检查恢复上下文。
- AgentSessionRuntime 替换实例后旧订阅失效，须重新绑定；业务 runId 与 SDK sessionId 分别管理。

## 验证层次

已做：真实包导入、Bun 本地循环、工具实际执行、事件、内存历史恢复、取消。模拟内容由本地 provider 生成，不经过真实大模型。

未做：真实供应商鉴权、模型自主知识访问质量、真实语音、模型输出 schema 成功率、付费请求成本、网络中断与多实例业务恢复。不能从离线通过推导这些结论。
