# 项目开发约定

## 文档读取

- 读取/转换 PDF、DOCX、PPTX、XLSX、HTML 等文档时，优先检查并使用 MarkItDown MCP。不可用时明确说明，再用本地 MarkItDown；检查提取内容非空且结构可用，必要时视觉/OCR 验证。

## 本项目

- 产品边界以 docs/prd.md 为准，设计见 docs/architecture.md，HTTP 联调先看 docs/api.md，协作规则见 docs/collaboration.md。当前是基础骨架，未实现业务接口返回 501，不能用 mock 成功冒充交付。
- Pi 开发先读 `.agents/skills/pi-agent-development/SKILL.md`，以安装包公开导出/声明为准；版本变更重跑离线集成，不照搬 main 或历史 Craft 示例。
- 业务 API 拥有正式数据、归属、任务和提交；Agent 不直写正式表；renderer 不导入 Node/SDK/数据库，preload 不暴露通用 IPC。
- `packages/contracts` 为跨服务 schema 真值；工具身份/岗位/权限/预算由宿主注入，严格校验模型参数。
- Bun 1.4.4/TypeScript strict/ESM；使用 bun.lock；Electron main/preload 使用 Electron 的 Node 环境，preload 单独 CJS 构建。
- 当前默认离线测试；接入真实付费模型/语音前须明确授权、供应商、凭证来源和预算，不读或复用个人密钥、订阅或全局 Pi 配置。
- 知识 sourceId/version/reviewStatus 可追溯，draft 不当 reviewed；评测数据分组隔离，真实/模拟证据分开。
- 有行为改动时运行相应测试；交付前运行 typecheck、test、pi:offline、check:knowledge、openapi:lint、desktop:build。构建不证明 GUI、麦克风、安装或数据库已验证。
- 不提交或推送未经用户要求的 Git 历史，不部署；不要更新全局技能或记忆。
