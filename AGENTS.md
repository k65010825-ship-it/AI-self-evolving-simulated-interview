# 项目开发约定

## 文档读取

- 读取/转换 PDF、DOCX、PPTX、XLSX、HTML 等文档时，优先检查并使用 MarkItDown MCP。不可用时明确说明，再用本地 MarkItDown；检查提取内容非空且结构可用，必要时视觉/OCR 验证。

## 本项目

- 当前提示规则：每道已发题最多2次有效提示，不扣金币；同题澄清/重启不重置，幂等/并发/辅助状态需持久化，模型费用/unknown独立管理。Agent负责人负责全部Agent/宿主/RPC/恢复实现；数据库负责人负责schema/DDL迁移/repository，联合回归边界见docs/database.md第8节。

- master 的 docs 只收团队共享需求/架构/协作/数据与对外接入契约，入口docs/README.md；Agent内部实现、调试与模块验收文档只留feature/agent。合并/生成时按范围选择，不整目录带回master。

- 产品边界以 docs/prd.md 为准，设计见 docs/architecture.md，HTTP 联调先看 docs/api.md，协作规则见 docs/collaboration.md。Agent开发为当前范围；未实现业务接口返回501，不能用mock成功冒充交付。
- 双端基线：Windows 学生客户端采用随包本地 Agent＋stdio＋用户 SQLite；网页管理端通过鉴权管理 API 访问中央 PostgreSQL。中央仅负责账号、团队内容/审核/分发、授权样本、实验与审计，不重新铺云端学生面试主流程。监控只读；正式发布/客户端采用未验收继续 not_published。
- 分支边界：共享 README/架构/需求/接口/协作文档在 master；本地宿主与核心实现在 feature/agent，数据库拆分在 feature/db 待合入。文档不等于实现已合主分支；现有 PG 或新 local-db 模型不自动替换本地 profile，迁移/回执/预算需单独适配验收。推送前同步 origin、解决冲突后同名推送，不强推。
- Pi 开发先读 `.agents/skills/pi-agent-development/SKILL.md`，以安装包公开导出/声明为准；版本变更重跑离线集成，不照搬 main 或历史 Craft 示例。
- 用户于2026-11-10确认客户端随包本地Agent设计，采用独立子进程＋stdio RPC，会话/记忆/任务落用户本机。团队接线见docs/local-runtime-api.md，内部设计在feature/agent维护。当前已实现本地文字及live接入机制（注入HTTP离线验证）、私有凭证帧及v1/v2到v3备份迁移、本地ASR确认/TTS分块（合成音频/注入HTTP验证）；真实语音质量/系统凭证库和桌面接线尚待验收，不拿旧服务端验收当本地客户端已交付。
- 正式数据写入应由宿主的命令/提交协调器负责：旧服务模式为业务API，迁移目标为本地宿主。模型/工具仍只产候选，不直接写正式表；前端由队友负责，本轮不实现或修改桌面客户端。
- `packages/contracts` 为跨服务 schema 真值；工具身份/岗位/权限/预算由宿主注入，严格校验模型参数。
- Bun 1.4.4/TypeScript strict/ESM；使用 bun.lock。
- 当前默认离线测试；接入真实付费模型/语音前须明确授权、供应商、凭证来源和预算，不读或复用个人密钥、订阅或全局 Pi 配置。
- 知识 sourceId/version/reviewStatus 可追溯，draft 不当 reviewed；评测数据分组隔离，真实/模拟证据分开。
- 有行为改动时运行相应测试；交付前运行 typecheck、test、pi:offline、check:knowledge、openapi:lint。离线通过不证明真实用户、人工质量或数据库部署已验证。
- 不提交或推送未经用户要求的 Git 历史，不部署；不要更新全局技能或记忆。
- 若存在本地 `.sdd/agent-learning/maintenance.md`，Agent 模块变更完成后按其同步个人教程、问题记录和周报。该本地约定不进入 Git，其他成员没有此文件时无需执行。

- 当前用户范围：只开发Agent及本地运行时/主进程通信契约；feature/agent 已删除桌面实现与专属构建，不重新添加；master 尚存历史骨架不代表新桌面已接线。不得用localhost服务套壳冒充本地宿主迁移。真实用户答案只能由用户本人输入，独立审核不能代填。
