# 团队文档入口

master 的 docs 只保留前端、后端与 Agent 共同协作需要的产品设计、职责、数据规则和对外联调契约。Pi/Harness、规划/评分/压缩/恢复实现、内部工具、调试记录和各模块验收手册保留在 [feature/agent 的 docs](https://github.com/k65010825-ship-it/AI-self-evolving-simulated-interview/tree/feature/agent/docs)，不随实现分支整体带回主分支。

## 阅读顺序

| 文档 | 读者与用途 |
| --- | --- |
| [需求 PRD](prd.md) | 全员；做什么、哪些必交、哪些尚未完成 |
| [架构与职责](architecture.md) | 全员；学生本地域/中央管理域、唯一写入方与部署边界 |
| [协作分工](collaboration.md) | 全员；三人任务、接口接手顺序、周会与 Git 规则 |
| [接口导航](api.md) | 前端/后端；本地 RPC 与管理 HTTP 的入口及实施状态 |
| [本地客户端接入](local-runtime-api.md) | 前端主进程与后端本地业务；启动、方法、任务、凭证与失败处理 |
| [数据库说明](database.md) | 后端；历史模型、迁移/repository设计及第8节负责人交接清单；Agent按清单做兼容回归 |
| [数据与内容治理](data-sources.md) | 全员；题库/资源审核、来源与授权样本、发布分发 |
| [产品验收计划](evaluation-plan.md) | 全员；双端联调、人工质量和系统改进的验收口径 |

## 机器可读接口

- [本地 RPC schema](local-runtime-schemas.json)、[语音 RPC schema](local-speech-schemas.json)：前端主进程使用的共享协议，完整实现和生成器在 feature/agent；不可手改生成物或当作 master 已具备相应运行时。
- [旧 HTTP OpenAPI](openapi.yaml)：master 历史服务骨架的生成契约，供维护旧入口；不是新管理 API 设计，也不是学生桌面面试入口。管理 API 完整契约由后端后续提交。

新增文档按读者和职责归类。共享协议即使名称含 Agent 也需保留；只供 Agent 开发者阅读的实现与实验说明不加入 master。接口行为变更先更新 contracts，再在实现分支生成并按所属范围提交；不要将生成器产出的全部内部文档直接带回 master。
