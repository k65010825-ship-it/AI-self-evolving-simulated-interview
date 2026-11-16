# Agent受控停机与资源排空

运行时增加内部`shutdown({graceMs,cancelWaitMs})`；默认宽限5000ms、取消后等待2000ms，上限分别30000/10000ms。`agent:shutdown:demo`演练双岗业务客户端SDK/HTTP/SSE与真实本机TCP关闭；`--in-process`不监听端口。评估依赖是本地受控Promise，非真实模型/语音，也不是Pi SDK性能评测。

## 生命周期

1. 第一次有效shutdown调用同步设置draining，所有start（包括旧请求重试）返回DEPENDENCY_UNAVAILABLE，经现有HTTP错误映射为503。无效参数先报VALIDATION_ERROR，不关闭准入。
2. 宽限期允许已有任务自然完成；snapshot/events/cancel保持可调用，现有客户端可读终态。health仍是原存活描述，不承担就绪探针职责；不表示可以准入。
3. 宽限期结束调用dispose，取消未完成业务，保留已完成候选/终态记录；统计本次取消数量。
4. 有限等待宿主可观察资源归零。非协作依赖或暂停在yield的订阅仍存在，则报告incomplete且保留残留；不会强制清零或撤销已完成候选。报告是冻结的时间点快照，迟到依赖结束不会回写旧报告。
5. shutdown重复调用共享同一Promise，首份有效参数生效；失败参数不会破坏原停机。dispose本身仍是立即取消，不等待资源排空。wait仍只等待业务终态。

`drained`要求activeRuns/occupiedSlots/inFlightDependencies/pendingWork/deadlineTimers/eventSubscribers全0，retainedRuns可以非0。计数范围沿用[并发隔离](agent-reliability.md)，不覆盖SDK内部、网络、供应商、OS。永久不响应的依赖会如实残留。轮询基于单调时钟预算，依赖事件循环可调度；同步CPU阻塞不可能被JS计时器强制中断。

## 服务接线

index.ts在Bun.serve后绑定SIGINT/SIGTERM：当下关闭准入，等待运行时shutdown，然后调用server.stop(true)强制关闭HTTP/SSE连接。重复信号不重复执行。服务关闭默认再等1000ms，上限5000ms，分别记录transport=closed/timed_out/failed；运行时错误也继续尝试关闭传输，不输出原始错误正文。

服务status=stopped仅表示运行时观察范围drained且传输关闭，或无运行时的scaffold传输关闭；其余为incomplete。日志固定event=agent.shutdown及聚合结果；incomplete设置process.exitCode=1，不调用process.exit，不强杀任意依赖。被外部强制结束、断电、无法送达的信号不在受控停机保证内；Windows服务管理器的真实信号递送与进程退出尚未验证。未添加远程停机路由。

默认先报告runtime排空再关闭传输，因此若订阅暂停导致runtime incomplete，随后连接关闭也不会把旧runtime报告偷偷改成drained。transport超时只限制等待，无法强制取消第三方stop Promise；故障处置须依据残留和外部部署约束。

## 演练与证据

```powershell
bun run agent:shutdown:demo
bun run agent:shutdown:demo --in-process
```

双岗流程：客户端start→等待依赖与事件订阅就绪→发起服务停机→依赖协作退出且SSE收到run.cancelled→传输关闭前查询cancelled与验证新start 503→关闭传输→真实TCP连接不再可用。只输出聚合结果和静态错误码，不输出token、题目/回答、原事件正文。in-process的transportClosed仅是注入关闭回调执行，不证明本机端口关闭；TCP模式才实际监听/探测端口。osSignalVerified=false明确区分函数接线与操作系统信号验证。

测试覆盖自然完成、非协作迟到结果、订阅残留、参数/重复调用、同步信号准入、runtime错误、传输拒绝/挂起及双岗HTTP/SSE演练。`agent:delivery`全仓测试覆盖回归，固定14阶段不变。正式业务API仍501，停机不提交画像/数据库、不实现持久恢复或生产部署。
