# 本地与服务器试点运行

本入口把已有模块接成可操作系统，业务持久化采用SQLite。默认离线，不自动使用已填写的Key；生产HTTPS、备份、签名与多实例配额仍需单独部署验收。

## 启动与配置

```powershell
bun run pilot:setup
bun run pilot:start
```

setup生成 `.cache/pilot/accounts.local.json` 与 config.local.json，均被Git忽略。默认账号student，随机密码从账号文件本地查看；可由运营者编辑用户列表，单密码至少12字符。修改密码/移除账号后重启API，会撤销其旧令牌。不要把账号文件、服务token或Key加入Git。

两台服务共享本机stateDir内的accounting.sqlite；业务API拥有api.sqlite，Agent拥有agent.sqlite/bindings.sqlite/speech.sqlite/voice.sqlite。`pilot:start`启动独立Agent与API子进程。也可分别执行：

```powershell
bun run scripts/pilot.ts agent --config .cache/pilot/config.local.json
bun run scripts/pilot.ts api --config .cache/pilot/config.local.json
```

API子进程清除供应商环境变量且禁用自动.env加载。Agent只解析项目指定Key，不读个人Pi或全局配置。当前服务仅绑定127.0.0.1；统一远程服务器应在同机反向代理API至HTTPS，Agent保持私有。客户端接线由队友负责，本轮不提供桌面入口。

## 在线模式

已授权使用的凭证槽位：

| 环境变量 | 来源与用途 |
| --- | --- |
| INTERVIEW_QIANWEN_API_KEY | 千问AI平台LLM，qwen3.8-max |
| INTERVIEW_BAILIAN_ASR_API_KEY | 用户已确认来自千问AI平台北京，Omni与TTS；保留旧变量名，不代表可复用阿里云百炼Key |

.env仅填写上述真实Key，不向对话粘贴。执行 `bun run pilot:setup --live`，重新启动服务。live授权默认1小时、最多32个运行；每场额度2元/40次尝试/并发2，按宿主声明费率估算。配置中的LLM最多8次/运行，统一会话额度仍是跨轮次最终约束。重试、修复、截断恢复均计入尝试。ASR/TTS/表达各保守预留0.10元/次，完成响应释放并发但不擅自释放费用，等待宿主结算；长期试点需导入实际用量。

关闭在线模式执行 `bun run pilot:setup`，再重启；不会替旧任务重放付费调用。不要修改既有会话不可变额度，调整政策须新建会话。TTS仅播报正式当前问题，忽略供应商返回下载URL，直接重建收到的音频；离线只返回提示音。Omni表达输出是未验证的观测估计，越界/无引用依据会拒绝，不纳入综合分。

## 恢复和对账

```powershell
bun run budget:session status --db .cache/pilot/state/accounting.sqlite --session <id>
bun run budget:session recover --db .cache/pilot/state/accounting.sqlite
bun run budget:session reconcile --db .cache/pilot/state/accounting.sqlite --file <evidence.json>
```

reconcile输入在 accounting-schemas.json：sessionId/attemptId/expectedVersion/reconciliationId/actualCostMicros/evidence，evidence包含kind(host-usage或host-imported-bill)、reference与sha256。CAS拒绝旧版本，重复相同reconciliationId幂等；超额结算锁定后续派发。导入只是宿主声明证据，vendorBillingVerified仍为false，工具不会认证供应商发票。

进程重启：已持久完成任务返回旧结果，不读Key或重收费；崩溃中的派发转unknown，未派发预留可释放；终态任务也恢复残留账目。API恢复running操作只查询原Agent任务，绝不另起新请求；可核验的已完成候选才提交CAS。TTS缓存过期running明确interrupted，保留unknown并拒绝自动重播。学生可查看状态或改用文字，运营者完成证据对账后才安排新的操作。Ctrl+C期间若仍有活跃语音/播报，会报告停机未完成；不能把该提示解释为所有远端调用已经停止。

## 检查、安装包与外部验收

```powershell
bun run agent:delivery
bun run evidence:field catalog .cache-field-review-new
bun run evidence:field readiness
```

桌面实现与安装包已按用户要求撤除，当前仅保留API/Agent联调入口。真人质量验收使用[Agent CLI](agent-field-acceptance.md)，客户端设备验证由前端同学负责。

本轮在线检查用本机Zira合成英文，不含真人语音。LLM规划及ASR已走真实API；TTS实际SSE兼容与WAV头重建已验证；Omni表达曾因证据时间超过真实时长被拒绝，后一次通过结构/区间校验但仍为unvalidated-model-estimate。网络200与结构校验不代表内容正确。独立质量/真实RSI数据依旧not_ready，两个岗位人工批准均为0。
