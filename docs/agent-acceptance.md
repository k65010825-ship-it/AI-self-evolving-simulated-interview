# Agent 离线验收与报告回放

供 Agent/业务后端联调及答辩复现使用，不新增业务接口或正式数据写入。固定使用既有本地 Pi provider、草案题库及明确合成的 RSI 来源；不能把通过报告当作模型质量、学生收益或生产验收。

## 运行

```powershell
# 默认：真实本机 TCP + SDK/HTTP/SSE；占用临时端口
bun run agent:acceptance

# 无端口环境：同一 Hono 应用的进程内传输
bun run agent:acceptance --in-process

# 填入上一命令输出的实际目录；只读校验，不重跑场景
bun run agent:acceptance --verify ".cache/agent-acceptance/run-实际目录/report.json"
```

每次运行新建 `.cache/agent-acceptance/run-*`，输出 `report.json` 与 `report.md`，不覆盖历史运行。产物默认不进入 Git；需要协作分享时选取并审核该次产物。命令不支持任意输出目录。案例失败仍保留完整报告并退出 1，不能只保留通过项。未知异常只输出静态代码，不打印原始异常或凭证。

## 固定验收矩阵

每岗六例，共十二例，顺序和预期断言固定。实际结果由运行器观察，报告校验器重新计算通过数。

| 场景 | 默认调用范围 | 检查 |
| --- | --- | --- |
| workflow | TCP、SDK、HTTP/SSE | create/plan/answer/finish重试/restore，revision为0/1/2/3/4/5/5/5，2题、未提交 |
| rsi | TCP、SDK、HTTP/SSE | 合成匹配率0.5→1，深度2→1预览、源深度2、重放版本保持1、未发布 |
| rollback | 宿主函数 | 回滚后保留原now重放，当前与下一场均为基线，版本2且不重新应用 |
| stale | TCP、SDK、HTTP/SSE | 202接受后实际failed/VERSION_CONFLICT，无结果和rsi成功事件 |
| leakage | TCP、SDK、HTTP/SSE | 验证集混入来源组，实际failed/VALIDATION_ERROR，无结果和rsi成功事件 |
| cancellation | 宿主函数 | 预取消返回RUN_CANCELLED，输入注册表未改变 |

`--in-process` 将八个 TCP 案例替换为进程内 HTTP 传输，四个宿主案例保持 host。预取消不代表已验证远程网络取消或所有并发取消时序。既有细粒度行为测试仍需单独执行。

## 报告与校验契约

`evals/acceptance/report.ts` 导出严格 Zod Schema 和校验器；这是开发验收产物契约，不是新增跨服务业务协议。报告仅保存固定断言的预期/实际安全值、角色/传输、耗时、时间、源码指纹、汇总及 SHA256。不保存完整输入、答题、题库、注册表、验证案例、服务令牌和原始异常。

`--verify` 检查 JSON（最大2MiB）、字段白名单、十二案例完整性/顺序、固定断言及预期、汇总和摘要，再比较当前源码指纹。检查通过仍可能是“合法且有失败案例”的报告，此时退出1。Markdown由已验证JSON生成；单独手改Markdown不影响JSON校验，应以JSON为准。

指纹覆盖根 package.json、bun.lock、tsconfig.json，Agent/契约/领域/SDK 各自的 workspace package.json，以及这些模块源码、experiments、evals、scripts、knowledge 中的 `.ts` / `.json`。同时覆盖 exports、依赖等模块解析配置；目录入口及发现的符号链接拒绝，解析后逃出工作区的路径拒绝。不读取.env、全局Pi配置或个人密钥；不证明已安装依赖与锁文件一致，也不认证报告来源。

摘要仅检测内容变化，不是签名。可以伪造并重算一份结构一致的报告，所以“校验成功”不能证明实际执行。真正回放是再次运行不带`--verify`的命令，得到新的时间与独立报告；不是执行报告中携带的代码。源码版本不同会报ACCEPTANCE_SOURCE_CHANGED，需在对应源码工作区校验旧报告或重新运行，不能直接改摘要消除差异。

为避免执行中修改源码导致证据混用，CLI前后各采集指纹。变化时只写source-changed.txt并退出1，不输出可误认成功的完整报告。每次任务保留固定规模；此命令不提供运行进程崩溃后的持久恢复。

## 结果边界与交接

合成四例的0.5→1只表示动作和技能标签匹配，不是学生学习收益或真实追问命中率。完整会话与RSI来源场景分别执行，不冒称同一名真实学生连续使用后的系统提升。报告不是全仓测试、真实ASR、Electron GUI、Windows安装包、正式数据库事务或生产部署验证。

业务后端接入仍按 [SDK](agent-client.md) 和 [会话HTTP](workflow-http.md) 进行身份、持久化、任务租约与CAS；RSI正式发布边界见 [实验说明](workflow-rsi.md)。分享报告时附命令、源码指纹、失败项和未验证范围，不将`.cache`整个提交到仓库。
