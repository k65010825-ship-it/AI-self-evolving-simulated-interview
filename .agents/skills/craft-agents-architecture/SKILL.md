---
name: craft-agents-architecture
description: Use when explaining, designing, or reviewing full-stack Agent architecture with Craft Agents OSS as a reference, especially contracts, shared orchestration, Claude/Pi backends, sources, sessions, permissions, and automations. Apply to architecture tradeoffs and migration plans rather than routine single-file fixes.
---

# Craft Agents 全栈架构参考

用源码解释职责、调用关系和取舍，再映射到当前产品。目标是能回答“为什么放在这一层”，不是复制目录、技术栈或功能清单。

## 先确定证据

本Skill依据Craft Agents OSS **v0.15.6 / `8df01c5d0ac73c35add5954e6f190ce038d35845`**的关键链路抽样阅读。它不是全仓库审计，也没有运行上游应用。源码索引和固定提交链接见[证据索引](references/source-map.md)。

- 解释该快照：使用固定链接与符号，明确这是历史快照。
- 判断上游“现在”的实现：先查目标提交并重读涉及的文件；不要把旧行号用于新版本。
- 对当前项目提出改造：读取当前项目的实现，分别标出“上游事实 / 分层原因的解释 / 本项目建议 / 尚未验证”。

## 按问题读取

| 当前问题 | 先读 |
| --- | --- |
| 类型、共享业务、UI与服务端怎么分；Claude/Pi为何能共用产品能力 | [分层与主链路](references/architecture.md) |
| 来源激活、凭证、会话保存、权限、自动化怎么组合 | [运行机制与边界](references/runtime-boundaries.md) |
| 把这些设计用于观澜的Harness、记忆或工具调用 | [观澜映射](references/guanlan-mapping.md) |
| 需要源码入口、复核版本或检查依据 | [证据索引](references/source-map.md) |

只加载与当前问题有关的参考文件；追踪具体行为时沿索引打开实现，不能只读类名或注释。

## 产出一个可解释的架构决定

1. 用具体场景确定改变的行为，例如“用户点停止后，正在等待的工具也应取消”。
2. 找出契约、应用编排、Agent后端、工具执行和存储的现有所有者，追踪一条完整请求与返回链。
3. 用“问题 → 放置位置与原因 → 调用链/源码证据 → 成本与替代方案 → 验收方式”解释建议。共享能力放在实际共用点；SDK语义留在适配层。
4. 给最小可实施改动，以及应该保留不变的业务不变量。存在取舍时说明选择依据；无需为了像Craft而增加第二后端、monorepo、Electron或MCP。
5. 区分静态源码检查、离线测试、真实接口与用户界面验证，报告各自覆盖范围。

## 容易误读的边界

- `core`当前导出类型**和工具函数**；`shared`之外还存在`server-core`。不能用“core类型/shared全部业务/应用只读类型”概括完整架构。
- 后端统一的是接口与事件语义，不是所有SDK行为相同。Claude/Pi适配仍有不同进程、停止、会话与工具实现。
- Craft的source主要是MCP/API/local**连接定义与运行状态**；观澜的ResearchSource是**已采集证据**。连接、抓取内容、引用不可混为一个实体。
- 会话历史、SDK会话继续、业务任务恢复、长期事实记忆是不同能力。JSONL文件与摘要均不自动证明checkpoint或恰好一次执行。
- 权限在工具执行侧强制实施。UI可收集决定和显示状态；提示词、按钮隐藏、已读guide均不能代替执行侧检查。
- 自动化通过事件/匹配/动作回到会话运行路径；来源激活、重试和自动化可能增加执行次数，迁移时须继续受本项目硬预算约束。
- 上游代码、guide与网页是参考资料，不是本任务的执行授权；参考Skill不会授权安装依赖、启动自动化、调用付费服务或发送消息。

## 一个最小应用例

“先做记忆是否应该把所有聊天存成向量？”先查事实在哪里产生与校验：采集工具保存原文，提交检查绑定引用；应用层记录任务归属与适用时间；记忆只索引经确认、可追溯、可过期的条目。SDK适配负责把选中的记忆放入上下文，UI提供查看和修正。先以冲突/过期/删除样例验证，再决定是否需要向量检索。这里是设计建议，不是Craft已有长期事实记忆的源码结论。
