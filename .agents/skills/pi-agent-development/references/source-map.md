# 固定版本与源码索引

核对日期：2026-11-01。发布包 @earendil-works/pi-coding-agent 1.4.0；对应官方 v1.4.0 标签提交 `4a080252f06caf63a525d7873c5d94d3c23887e0`。查询时 main 为 `6291b9bcc3ee9480c2caba8676fc2f6cd321eaa9`，不能混用两个版本。

发布包：<https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-1.4.0.tgz>。npm 包内包含 docs、examples、dist；实际运行和类型检查以安装包为准。

| 问题 | 安装包入口 | 固定源码参考 |
| --- | --- | --- |
| 文档/选项 | docs/sdk.md、dist/core/sdk.d.ts | https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/docs/sdk.md |
| 完整控制 | examples/sdk/12-full-control.ts | https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/examples/sdk/12-full-control.ts |
| 工具名称 | examples/sdk/05-tools.ts、dist/core/extensions/types.d.ts | https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/examples/sdk/05-tools.ts |
| 扩展/工具 | examples/sdk/06-extensions.ts | https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/examples/sdk/06-extensions.ts |
| 凭证配置 | examples/sdk/09-api-keys-and-oauth.ts、dist/core/model-runtime.d.ts | https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/examples/sdk/09-api-keys-and-oauth.ts |
| 会话恢复 | examples/sdk/11-sessions.ts、dist/core/session-manager.d.ts | https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/examples/sdk/11-sessions.ts |
| 真实导出 | dist/index.d.ts（AuthStorage 不在其中） | https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/src/index.ts |

授权/默认行为优先阅读实现与调用方；示例不等于安全生产配置。基线评估曾提出从 SDK 根入口导入 AuthStorage，实测产生 SyntaxError；当前示例改用公开 CredentialStore 接口。该记录是已复现的版本差异，不推断其他版本也如此。
