# Pi SDK 离线验证与运行边界

验证基线：coding-agent/pi-ai 1.4.0、Bun 1.4.4、Node 24.15.0。版本变化后重跑，不将旧结果视为新版本保证。

项目入口：`experiments/pi-sdk/offline-spike.ts`；执行 `bun run pi:offline`。没有全局 Bun 时使用 README 的本地二进制入口。`tests/pi-isolation.test.ts` 将同一集成纳入 `bun test`。

该示例使用真实发布 SDK 与确定性本地 provider：先返回工具请求，SDK 实际调用岗位种子知识工具，消费回执后完成回答；另测取消终态。工具和资源限制、message_end/agent_settled、内存历史恢复均由断言检查。知识是 draft 种子，不是已审核正式题库；最终文本来自 fixture，不是真实模型推理。

历史恢复当前只比较上下文消息数；不证明所有消息内容/工具结果关联完全等价，也不提供数据库任务恢复保证。后续应在相应功能迭代增加内容比对。

本地 provider 的实际调用不等于真实 LLM 端点调用，离线示例不使用模型额度。它不验证供应商鉴权、模型自主工具选择质量、真实费用、网络中断/取消、语音、数据库持久化、多实例或 Windows GUI/安装包。

凭证使用公开 CredentialStore 接口；1.4.0 SDK 根入口导入 AuthStorage 会失败。默认资源发现和编码工具必须被显式替换/限制。完整 API 与固定源码入口见 [sdk-reference.md](sdk-reference.md) 和 [source-map.md](source-map.md)。

项目锁定 minimatch/undici 补丁依赖，升级时结合实际审计与离线回归，不能从上游 main 推断 npm 发布包已修复。
