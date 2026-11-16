# AI 自进化模拟面试工作台



## 项目简介



面向计算机相关专业学生的 AI 模拟面试平台，首批支持 **Java 后端**和 **Web 前端**岗位。通过多轮语音/文字面试、状态感知追问、多维评估和个性化复测，帮助学生发现并改善能力短板；系统根据历史评估与后续表现迭代追问策略，形成学生成长与系统自校准两个闭环。

交付形式为 **Windows Electron 客户端＋统一服务器**，目标交付日期为 **2026 年 12 月 19 日**。

当前仓库处于开发骨架阶段：已有 Pi SDK 离线工具循环、岗位知识草案、共享契约、健康接口及桌面构建入口；正式面试、登录、语音评估、数据库任务和 RSI 业务流程待实现。

## 开发入口



需要 Node.js ≥24、Bun 1.4.4。依赖以 `bun.lock` 为准。

安装依赖并启动服务（API 与 Agent 分别在两个终端启动）：

```
bun install --frozen-lockfile --ignore-scripts
bun run dev:api
bun run dev:agent
```

API：`http://127.0.0.1:3100/health`；Agent：`http://127.0.0.1:3200/health`。当前仅健康接口可用，业务接口返回 `501 NOT_IMPLEMENTED`。

构建和启动桌面客户端：

```
bun run desktop:runtime
bun run desktop:build
bun run desktop:start
```

`desktop:runtime` 下载 Electron 运行时。依赖安装默认禁用安装脚本，因此首次启动桌面前需要执行；桌面 GUI、麦克风与安装包仍需单独验收。

开发检查：

```
bun run typecheck
bun test
bun run pi:offline
bun run check:knowledge
bun run openapi:generate
bun run openapi:lint
```

`pi:offline` 使用真实 SDK 和本地确定性 provider，不调用付费模型。模型与语音供应商尚未配置；配置项模板见 [.env.example](https://github.com/k65010825-ship-it/AI-self-evolving-simulated-interview/blob/feature/api/.env.example)。

<details style="box-sizing: border-box; display: block; margin-top: 0px; margin-bottom: 16px; color: rgb(31, 35, 40); font-family: &quot;Mona Sans VF&quot;, -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, &quot;Noto Sans Backtick Fix&quot;, &quot;Noto Sans&quot;, Helvetica, Arial, sans-serif, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;; font-size: 16px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; background-color: rgb(255, 255, 255); text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;"><summary style="box-sizing: border-box; display: list-item; cursor: pointer;">Windows 没有全局 Bun 时的引导方式</summary><p dir="auto" style="box-sizing: border-box; margin-top: 0px; margin-bottom: 16px;">在项目根目录执行，不用 npm 安装带 <code style="box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, &quot;SF Mono&quot;, Menlo, Consolas, &quot;Liberation Mono&quot;, monospace; font-size: 13.6px; white-space: break-spaces; background-color: rgba(129, 139, 152, 0.12); border-radius: 6px; margin: 0px; padding: 0.2em 0.4em;">workspace:*</code> 的项目本身：</p><div class="highlight highlight-source-powershell notranslate position-relative overflow-auto" dir="auto" style="box-sizing: border-box; overflow: auto !important; position: relative !important; margin-bottom: 16px; background-color: rgb(246, 248, 250); justify-content: space-between; display: flex;"><pre style="box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, &quot;SF Mono&quot;, Menlo, Consolas, &quot;Liberation Mono&quot;, monospace; font-size: 13.6px; margin-top: 0px; margin-bottom: 0px; overflow-wrap: normal; padding: 16px; color: rgb(31, 35, 40); background-color: rgb(246, 248, 250); border-radius: 6px; line-height: 1.45; overflow: auto; word-break: normal;">npm install <span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">--</span>prefix .tools<span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">/</span>bun <span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">--</span>ignore<span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">-</span>scripts <span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">--</span>no<span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">-</span>audit <span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">--</span>no<span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">-</span>fund <span class="pl-smi" style="box-sizing: border-box; color: rgb(31, 35, 40);">@oven</span><span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">/</span>bun<span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">-</span>windows<span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">-</span>x64<span class="pl-smi" style="box-sizing: border-box; color: rgb(31, 35, 40);">@1<span class="pl-smi" style="box-sizing: border-box; color: rgb(31, 35, 40);">.4.4</span></span>
<span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">&amp;</span> .\.tools\bun\node_modules\<span class="pl-smi" style="box-sizing: border-box; color: rgb(31, 35, 40);">@oven</span>\bun<span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">-</span>windows<span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">-</span>x64\bin\<span class="pl-c1" style="box-sizing: border-box; color: rgb(5, 80, 174);">bun.exe</span> install <span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">--</span>frozen<span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">-</span>lockfile <span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">--</span>ignore<span class="pl-k" style="box-sizing: border-box; color: rgb(207, 34, 46);">-</span>scripts</pre><div style="box-sizing: border-box;"></div></div><p dir="auto" style="box-sizing: border-box; margin-top: 0px; margin-bottom: 16px;">随后可将上文的 <code style="box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, &quot;SF Mono&quot;, Menlo, Consolas, &quot;Liberation Mono&quot;, monospace; font-size: 13.6px; white-space: break-spaces; background-color: rgba(129, 139, 152, 0.12); border-radius: 6px; margin: 0px; padding: 0.2em 0.4em;">bun</code> 替换为 <code style="box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, &quot;SF Mono&quot;, Menlo, Consolas, &quot;Liberation Mono&quot;, monospace; font-size: 13.6px; white-space: break-spaces; background-color: rgba(129, 139, 152, 0.12); border-radius: 6px; margin: 0px; padding: 0.2em 0.4em;">&amp; .\node_modules\@oven\bun-windows-x64\bin\bun.exe</code>。Linux 服务端使用预装 Bun。</p></details>

## 系统目录



```
.agents/skills/              Pi SDK 开发与 Craft 架构参考 Skill
apps/
  desktop/                   Electron main / preload / React renderer
  api/                       业务 API、会话与正式数据的服务入口
  agent/                     Pi 适配、面试编排与工具执行
packages/
  contracts/                 跨服务 Zod 契约、错误与事件
  interview-domain/          纯领域规则
  db/                        Drizzle 数据模型
knowledge/                   两岗知识、题目草案与来源登记
experiments/pi-sdk/          可复现的离线 SDK 示例
evals/                       评测数据清单与说明
infra/                       开发基础设施配置
scripts/                     构建、数据检查与接口文档生成
tests/                       行为与 SDK 集成测试
docs/                        需求、接口与团队开发文档
```

## 项目架构



下面是目标架构；当前已实现的基础能力见需求文档中的状态表。

<iframe title="File display" role="presentation" class="render-viewer" src="https://viewscreen.githubusercontent.com/markdown/mermaid?docs_host=https%3A%2F%2Fdocs.github.com&amp;color_mode=light#a1af4b1b-ca64-408d-a556-65141ab58739" name="a1af4b1b-ca64-408d-a556-65141ab58739" data-content="{&quot;data&quot;:&quot;flowchart LR\n  subgraph Windows客户端\n    UI[React 界面] --> Bridge[Preload 白名单桥接]\n    Bridge --> Main[Electron 主进程]\n  end\n  Main -->|HTTPS / SSE| API[业务 API]\n  API -->|内部 HTTP| Agent[独立 Agent 服务]\n  API --> DB[(PostgreSQL)]\n  API --> Files[私有文件存储]\n  Agent --> Pi[Pi SDK 适配层]\n  Agent --> Tools[授权知识与评分工具]\n  Pi --> Models[大语言模型]\n  Agent --> Speech[语音服务]\n&quot;}" sandbox="allow-scripts allow-same-origin allow-top-navigation allow-popups" x_video_el_visible="false" style="box-sizing: border-box; border: 0px; width: 838.906px; height: 194.783px; display: block;"></iframe>

业务 API 管理身份、会话、画像和正式结果；Agent 负责规划、评估、工具调用与反思。模型和语音凭证保留在服务端。Electron 的主进程使用自带 Node.js，Bun 用于工程和服务端。

## 技术栈



层级技术用途工程Bun Workspaces、TypeScript strict、ESM单仓库与共享契约桌面Electron、Vite、esbuild桌面宿主、界面与主进程构建界面React、Tailwind CSS、Radix UI页面与交互；Jotai / TanStack Query 为状态与请求管理依赖API / AgentHono、Zod、Pi Agent SDK业务接口、运行时校验、Agent 运行数据PostgreSQL、Drizzle ORM业务数据；当前只有初始 schema 和开发配置通信Electron IPC、HTTP、SSE进程桥接与服务事件；业务流待接入质量Bun Test、TypeScript、Redocly行为测试、类型检查与 OpenAPI 校验



## 文档



文档主要内容[需求文档（PRD）](https://github.com/k65010825-ship-it/AI-self-evolving-simulated-interview/blob/feature/api/docs/prd.md)产品范围、用户流程、需求编号、验收与当前状态[接口文档](https://github.com/k65010825-ship-it/AI-self-evolving-simulated-interview/blob/feature/api/docs/api.md)服务地址、鉴权约定、HTTP 请求示例、状态与事件、联调边界[项目架构](https://github.com/k65010825-ship-it/AI-self-evolving-simulated-interview/blob/feature/api/docs/architecture.md)模块责任、数据模型、运行与恢复、Agent 和 RSI 设计[协作与里程碑](https://github.com/k65010825-ship-it/AI-self-evolving-simulated-interview/blob/feature/api/docs/collaboration.md)三人分工、接口变更流程、PR 与每周交付[数据源](https://github.com/k65010825-ship-it/AI-self-evolving-simulated-interview/blob/feature/api/docs/data-sources.md)知识来源、数据组织、审核与生命周期[Agent 工具契约](https://github.com/k65010825-ship-it/AI-self-evolving-simulated-interview/blob/feature/api/docs/tool-contracts.md)工具输入、回执、岗位授权与调用预算[错误处理](https://github.com/k65010825-ship-it/AI-self-evolving-simulated-interview/blob/feature/api/docs/error-handling.md)错误码、重试与取消规则[评测计划](https://github.com/k65010825-ship-it/AI-self-evolving-simulated-interview/blob/feature/api/docs/evaluation-plan.md)数据划分、指标、对照实验与验收方法[OpenAPI](https://github.com/k65010825-ship-it/AI-self-evolving-simulated-interview/blob/feature/api/docs/openapi.yaml) / [工具 JSON Schema](https://github.com/k65010825-ship-it/AI-self-evolving-simulated-interview/blob/feature/api/docs/tool-schemas.json)由生成脚本维护的机器可读契约



参与开发先读需求与接口文档，再按分工阅读架构和工具契约。自动化编码约定见 [AGENTS.md

## 文档

- [数据库设计](docs/database.md)、[原型交接文档](docs/HANDOFF.md)（与当前PRD/接口冲突时以当前契约为准）

- [需求与验收](docs/prd.md)、[架构](docs/architecture.md)、[接口](docs/api.md)、[协作分工](docs/collaboration.md)
- [客户端本地运行时设计](docs/client-runtime.md)、[stdio协议与随包启动](docs/local-runtime-api.md)、[live与凭证代理](docs/client-live-runtime.md)、[本地语音](docs/client-speech-runtime.md)、[本地在线验收](docs/local-online-acceptance.md)
- [试点运行、配置与恢复](docs/pilot.md)、[机器可读API](docs/openapi.yaml)
- [会话编排](docs/session-workflow.md)、[澄清与弃评](docs/workflow-clarification.md)、[记忆与上下文](docs/memory-context.md)
- [模型恢复](docs/model-recovery.md)、[任务持久化](docs/durable-runtime.md)、[统一会话预算](docs/session-accounting.md)
- [真人双岗验收](docs/agent-field-acceptance.md)、[语音任务](docs/speech-tasks.md)、[表达观察](docs/expression-assessment.md)
- [独立审核与真实队列](docs/field-evidence.md)、[知识审核](docs/knowledge-curation.md)、[评测计划](docs/evaluation-plan.md)
- [反馈事实与引用支持度复核](docs/feedback-review.md)
- [反馈发布隔离与复核回执](docs/feedback-publication.md)
- [反馈修订候选与版本回放](docs/feedback-revision.md)
- [会话收尾修订预览](docs/closeout-preview.md)
- [结构化输出失败诊断与引用冲突边界](docs/output-diagnostics.md)
- [Agent主流程演示与联调验收](docs/agent-journey.md)

