# 本地子进程生命周期与受限诊断

## 分层

`spawnLocalAgent`只验证路径、隔离环境并启动随包进程；`bindLocalProcess`持有RPC等待集、凭证代理、管道与进程生命周期；process-diagnostics只投影受限事件。数据库、桌面、供应商与任务重跑不进入这层。默认请求15秒、关闭请求2秒和关闭等待2秒/1秒均未增加，没有自动重试。

## 终态与尾部响应

- exit说明进程已结束，但stdout/stderr仍可能有缓冲数据。SDK停止接新请求，保留已有请求直到合法响应/close/原请求期限；close才处理未完成等待集。
- stdout收尾调用UTF-8解码器flush，半截编码/JSON记为LOCAL_PROTOCOL_INVALID；不能把残片当正常退出。完整有效响应先结算请求，再关闭连接。
- 任一请求超时、管道或协议故障，立即让连接失效并拒绝所有等待请求，撤销凭证代理。迟到帧不能复活请求，终止只针对SDK自己创建的子进程。
- 并发close共享同一个关闭Promise。正常结果或有界失败一致，不能让第二调用方无限等待exit。失败不冒称已释放profile。

这些是受控事件顺序与故障注入已验证的缺陷修复；不能据此认定历史随机退出均来自同一原因。历史无诊断样本不补造原因。

## 可观测性与隐私

运行时stderr仅写严格schema诊断，覆盖bootstrap/host-ready、RPC接收、输入错误、输出错误/超时及关闭。动态导入宿主前写bootstrap，故障原因仅映射预定义启动错误码；未知异常不传message/stack。

SDK始终排空stderr，只接收ASCII完整白名单行，4096字节超限/非法UTF-8/任意依赖文本/额外字段全部丢弃；保存最近64个事件和丢弃计数，relative elapsedMs使用单调时钟。writer总输出预算16KiB，观察回调隔离；默认不写文件、不上传、不包含参数/答案/路径/key。阶段是排障线索，非认证或费用证据。最后client/runtime事件随传输Error返回，完整ring通过diagnostics()获取。

## 验证

`bun --no-env-file test tests/local-process-lifecycle.test.ts tests/local-process-diagnostics.test.ts tests/local-process-integration.test.ts tests/local-clarification-continuity.test.ts tests/local-stdio.test.ts`

受控子进程验证exit→尾部响应→close、单超时终止全部等待、残帧/管道错误、并发关闭期限；实际临时profile验证启动拒绝原因、正常关闭与双岗澄清/回执恢复。沙箱虚拟Temp可能触发路径拒绝，须按实际阶段区分环境，不放松原路径防护。独立12例诊断复查未重现原随机失败，不代表长期稳定性已证明。
