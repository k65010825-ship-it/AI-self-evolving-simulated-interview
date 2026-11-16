# Agent并发隔离与故障恢复评测

运行`bun run agent:reliability`，在`.cache/agent-reliability/run-*`生成JSON/Markdown报告。`bun run agent:reliability --verify .cache/agent-reliability/run-实际目录/report.json`只读校验schema、固定场景/检查、计数、摘要及当前源码，不执行场景。退出0为全部通过，1为场景/源码一致性失败，2为参数或产物错误。只接受固定模式，读取上限4MiB、严格UTF-8、不接受符号链接。Markdown为展示副本，权威校验对象是JSON；SHA不是签名，也不是独立执行证明。

## 当前验证范围

| 固定场景 | 观察点 |
| --- | --- |
| parallel_isolation | 四用户、Java/Web各两会话，共享本地ModelRuntime而每次创建独立Pi Session；四路全部进入provider后乱序释放；独立回答/岗位/状态、单用户历史、事件run/attempt/seq正确；第五路RATE_LIMITED |
| cancel_late_capacity | 不响应AbortSignal的依赖：取消后无结果，原Promise未结束仍占一个名额；迟到结果不能复活，结束后新run可准入 |
| timeout_late_capacity | 同上，终止原因为DEADLINE_EXCEEDED；检查slot保留及释放 |
| subscriber_disconnect | 终止事件订阅不会取消任务；订阅计数归零；完成后按游标重放连续序号 |
| sdk_cancel | 真实Pi SDK、本地确定性provider收到abort；宿主任务取消无结果，协作处理器退出 |
| dispose_restart | dispose取消旧任务并拒绝新任务；新建manager找不到旧run，同ID可以重新执行，明确不具备重启持久恢复 |

只有parallel/sdk_cancel运行真实Pi SDK，其provider为本地fixture，真实模型调用始终0。其余为受控依赖Promise，专门覆盖不协作取消与时序。没有本机TCP/付费模型/ASR/数据库/GUI操作，不读取个人凭证。固定局部并发是正确性基线，耗时只是本机合成观察，不是模型性能、生产容量或教学质量指标。

## 名额与资源语义

`maxActiveRuns`约束占用任务数：queued/running，或业务已终止但编排/注入依赖Promise仍未settled，均占一个名额。同一run多次依赖不重复占槽。即使`wait`已返回，非协作依赖仍可能占槽；不得通过取消、新建run无限绕开并发限制。Promise结束后自动释放占槽；永不结束的依赖会继续阻断新准入，需要故障隔离/进程处置，不能强行把计数清零冒充释放。多manager和多进程的名额独立，不是全局限流。

内部`manager.diagnostics()`只返回聚合计数：activeRuns、occupiedSlots、inFlightDependencies、pendingWork、deadlineTimers、eventSubscribers、retainedRuns及disposed。统计只覆盖宿主编排、注入的evaluate/plan Promise、manager自身deadline计时器和订阅，不代表SDK内部、网络/供应商、OS资源计数。不暴露HTTP调试路由或用户内容。

`maxRuns`仍限制保留条目，终态数据不自动淘汰；释放活动槽不等于删除重放历史。dispose幂等并撤销提交资格，不删除内存历史，也不能强制终止不合作的第三方异步任务。wait等待业务终态，与依赖Promise全部释放、正式数据库提交是三件事。画像/正式存储、任务fence、鉴权和事务仍由业务API负责，公开业务接口仍501。

## 报告与交付

六场景固定顺序，检查项和成功指标受schema约束；失败继续收集其他场景，只保存静态SCENARIO_FAILED，不保存任意错误正文、回答/事件正文或原始日志。包含前后源码一致性、固定安全数值、true/false检查及明确未验证项。源码范围复用[统一交付验收](agent-delivery.md)，变化后不能复用旧报告。

本命令是独立专项评测，未改变`agent:delivery`的固定14阶段语义；全仓test包含专项回归，因此交付测试会覆盖它，但需单独运行命令获得可分享的专项报告。源码变化后重新运行两命令。服务进程崩溃后的持久恢复、真实网络取消、数据库一致性和生产负载仍需独立验证。
