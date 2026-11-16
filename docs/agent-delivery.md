# Agent统一离线交付验收

`bun run agent:delivery`把工程检查和现有离线演练组织成同一次验收。只证明当前源码的工程与合成场景结果，`productReady=false`、`formalCommitted=false`始终不变；不调用真实模型/语音，不部署、不上传、不提交Git。

## 命令与返回值

```powershell
bun run agent:delivery
bun run agent:delivery --in-process
bun run agent:delivery --scenarios-only --in-process
bun run agent:delivery --verify .cache/agent-delivery/run-实际目录/report.json
```

默认`full + tcp`。`--in-process`仅更换场景传输，full中的`bun test`仍含localhost TCP集成测试，需要运行环境允许本机监听。`--scenarios-only`跳过六项工程检查，所有场景通过仍是`incomplete`；测试内部只调用这一模式或注入执行器，避免验收递归启动自身。

退出码：0表示本次无失败（可能是`incomplete`），1表示报告中有失败/取消，2表示参数、源码采集或产物生成/校验失败。自动化必须读取报告`status`，不能只以退出码0认定全量通过。参数不支持任意命令、供应商、模型或自定义输出路径。

## 固定阶段

| 阶段 | 执行与判定 |
| --- | --- |
| typecheck / test / pi_offline / knowledge_check / openapi_lint | 固定五命令顺序执行；test要求退出0且Bun摘要有正数通过、0失败和断言计数 |
| model_preflight | 离线配置可用，planned配置禁止在线执行，未检查凭证 |
| knowledge_catalog | 当前固定24条草案、20条结构可送审、0 reviewed；两岗均有资料 |
| curated_knowledge | 两岗真实Pi离线工具查询；draft-preview选题，reviewed-only关闭 |
| budget | 两岗未知用量保留、并发阻断、超额锁定；仅合成用量 |
| acceptance | 固定12场景，含RSI/回滚/过期/泄漏/取消；复用原验收报告语义校验 |
| answers_development | 仅6条development回答，全部完成；草案标签不支持质量结论 |
| workflow_commit | 两岗内存CAS冲突、幂等重放、完成但未正式提交 |
| source_integrity | 执行前后源码指纹必须相同 |

独立阶段失败后继续收集其他结果；取消后续阶段标为`not_run/cancelled`，整体验收失败。test子进程总时限180秒，其他工程子进程每项120秒；这只是离线检查器的阶段时限，不改变模型请求、重试或业务运行期限。合计输出上限1MiB，仅暂存32KiB尾部解析测试计数，不持久化日志或任意异常正文。使用固定Bun命令、无shell、环境变量白名单及`--no-env-file`；这不是操作系统网络或秘密隔离沙箱。超时/取消尝试终止自身进程树，Windows使用自有PID的taskkill；不能据此保证任意第三方脱离进程均被清理。

场景每组60秒；超时/取消后不接受迟到结果，不写迟到产物。已有场景内部另有预算；外层超时不会强制中断同进程中的任意第三方异步工作。不会执行validation/reserved-final，也不会自动批准知识或发布策略。

## 产物与校验

每次生成独立`.cache/agent-delivery/run-*`目录：

- `report.json`：固定13阶段（Agent-only v2）、状态、测试计数、运行版本、源码清单、证据文件字节数/SHA256、摘要与未验证项。
- `report.md`：可读报告。`handoff.md`：前后端协作者入口及数据提交边界。
- `scenarios.json`：仅固定名称的布尔检查，不含题目/回答/量规或原始日志。
- `acceptance.json`、`answers-development.json`：对应阶段有可校验结果时保存原模块安全报告；失败阶段不伪造补齐。

`--verify`只读取已有目录：严格schema、摘要、所有固定文件名、大小/UTF-8/SHA256、源清单、子报告语义及Markdown再生成一致性。不执行报告中的命令；校验通过不代表重新跑过测试。文件上限4MiB，拒绝链接、未知文件及目录外证据路径。

源码指纹覆盖apps/packages/tests/scripts/experiments/evals/knowledge/docs中的固定源码格式与根package.json、bun.lock、bunfig.toml、tsconfig.json、README.md、AGENTS.md；排除依赖、构建产物、缓存与本地技能/过程文件，不遍历隐藏目录。不读取`.env`/PEM/密钥库或全局Pi配置；源码内不能内嵌秘密。新源码、文档或测试变更后应重新运行，旧报告会因源码不匹配而拒绝复用。SHA不是签名，攻击者可重写整份报告；它用于发现损坏和不一致，不是独立执行证明或供应链认证。

## 三人协作交接

分享相同源码和这个运行目录，避免分享整个.cache或个人学习笔记。后端先看[客户端契约](agent-client.md)与[候选提交](workflow-commit.md)，在正式鉴权、任务fence和数据库事务中实现CAS。前端按[业务API](api.md)对接；renderer不可加载SDK/密钥。公开业务接口仍501，不能把离线候选、合成RSI或内存提交当正式业务成功。

仍需独立验收：人工题库/标签审核、真实模型和语音、数据库事务与正式鉴权、GUI/麦克风/Windows安装包、生产部署。当前通过数量和延迟以本次报告为准，不把草案评分误差或合成指标变成教学效果提升。
