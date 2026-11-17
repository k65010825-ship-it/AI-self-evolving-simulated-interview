# 本地真实模型与凭证代理接入设计

## 对账事务与恢复验收边界

local-live-store的reconcile在同一profile事务内更新完整预算checkpoint并插入唯一对账回执。回执写入失败时，版本/unknown/占用/消耗一起回滚；受控修复故障后仍可按原版本提交。成功回执按原session/job/run/attempt/call与usage/evidence绑定跨重启幂等返回，不能二次扣费或改历史用量；任务终态不变，花费的调用次数不返还。

tests/local-reconciliation-atomic.test.ts使用测试库触发器注入写入失败，证明原子性和重放；现有恢复回归继续验证unknown阻断、grant续期不重置额度、旧owner不能写入。全部为工程fixture，不读取真实凭证，不证明供应商账单或收费请求物理恰好一次。

2026-11-13。承接已确认的[本地运行时设计](client-runtime.md)。**用户已于2026-11-13确认并进入实施：本地live文字执行、私有凭证代理与v2迁移已落地，验收采用注入HTTP和合成凭证。** 本轮不读取真实Key、不发付费调用、不修改桌面或既有用户数据库。

## 1. 选定边界

沿用主进程代理凭证、私有stdio、本地宿主提交与单profile SQLite。新增仅限LLM文字链路；本地语音已于第三阶段接入并离线注入验证，见[语音运行时](client-speech-runtime.md)；系统凭证库UI继续由队友接线。旧服务live runtime不能直接接上：它默认process.cwd、每run预算和服务授权；这些需要宿主注入与持久总额度适配。

不使用环境继承或把Key写入本地配置。一次性初始化传Key虽然简单，但会扩大存活时间；采用按需请求、短期授权的主进程凭证代理。该代理是主进程SDK的独立回调能力，不是渲染层可调用的通用RPC。

## 2. 协议与凭证生命周期

- 协议保持版本1并通过initialize.capabilities协商新增能力。普通initialize仍无Key，默认离线。主进程SDK通过request(live.authorize)授权，新增resolveCredential回调，不能把通用request或凭证方法暴露给preload。
- 主进程显式发送不含秘密的live grant：grantId、provider/model/固定endpoint、credentialRef、到期时间、允许的sessionId、最多HTTP次数/token/声明费用、每次timeout及恢复策略。grant不是仅凭保存模型配置就启用。
- 供应商白名单与恢复策略由公共schema和宿主校验。最初沿用已有千问兼容适配，不新增未验证供应商或推定其response_format支持。
- 运行时需要凭证时，在私有stdout发独立credential-request，带随机requestId、当前grantId及credentialRef；主进程核验当前子进程、授权绑定和引用后才调用resolver。返回只进入私有stdin的credential-response，不进入普通request队列、通知订阅、业务事件、诊断或SQLite。
- 两端使用独立帧schema、待决映射和次数/超时上限，拒绝不匹配、重复、迟到、未协商的回执。不得返回Key作为普通RPC结果。resolver的原始错误不跨进程。
- Key仅保存在请求级内存闭包，在授权结束/取消/关闭后解除引用；不宣称JS字符串可安全擦除或“绝不出现在进程内存”。不缓存到磁盘、argv、env、日志、安装包或模型提示词。真实Key不参与自动测试。
- resolver接口由Agent侧交付，Windows凭证库具体读取由桌面主进程队友实现；离线用合成resolver验收，不代称系统凭证库接好。

## 3. 正式模式与核心复用

本地命令/job持久化其evidenceMode和不含密钥的grant/profile版本及摘要；离线任务永远使用离线provider，live任务无授权就拒绝，禁止无声回退到fixture成功。模式必须在session创建时固定，后续回答不得切换历史来源。

创建顺序明确为：`session.create(mode=live,sessionBudget=...)`先在本机生成sessionId并完成**无模型**的创建候选/提交，返回authorizationStatus=required；不创建供应商会话、不取Key、不消耗HTTP。随后主进程针对已存在sessionId提交grant，成功后才允许nextQuestion/answer。无授权仍可读取和显式无模型收尾空会话；不能将此例外扩展到规划/评分。会话原截止时间从创建开始，不因等待授权重新计时。同岗场次限制保持。

复用createLiveRunManager、Pi evaluator/planner/delivery、压缩及恢复；为live runtime新增受信cwd/assetsRoot依赖，沿用本地onCheckpoint与正式提交协调。规划/评分只产候选，同库fence、revision、期限、当前memory及原提交校验继续决定写入资格。

授权撤销停止后续派发并取消相关任务；不能保证供应商停止已发请求或退款。Key缺失/获取超时在派发前失败，HTTP计数为0。模型响应通过不代表评分质量通过。

## 4. v1到v2：先备份再迁移

现有v1表local_budget不足以持久记录grant与完整模型检查点，不能仅增加live开关或修改user_version。

1. 打开数据库，检查版本和当前profile租约；未取得有效所有权时不得迁移。高于v2版本拒绝，无自动降级。空库直接初始化v2。
2. 关闭业务准入，确保无任务/模型请求运行；以同连接SQLite一致性快照/备份机制生成v1副本，记录profileId、原schema、摘要和备份路径。备份路径固定在profile/backups，完整祖先检查先于建目录；备份失败或磁盘不足时保留v1并停止，不继续DDL。
3. 数据库事务内新增local_live_grants、local_model_checkpoints及逐次attempt绑定结构；保留v1会话、记忆、job、事件和回执；PRAGMA user_version=2与DDL同事务提交。迁移不重跑任务、不改旧evidenceMode或分数。
4. 迁移异常回滚，留下备份；不自动将备份覆盖回用户主库。迁移成功也保留原备份，备份含用户回答须与profile同权限管理。manifest版本与DB schema版本分离，避免双文件原子更新假象。
5. 旧v1 local_budget中的unknown/dispatched不能忽略：迁入隔离的legacy未清消耗状态，仍阻止live派发；无映射不得伪造settled或归入新grant。正常离线用户不因此产生虚构收费记录。

实施时以实际Bun SQLite发布API验证备份方式和故障语义；不以直接复制活动WAL主文件冒充一致性快照。

## 5. 持久额度与恢复

grant及其固定profile摘要写入同库，不持久化秘密。每个网络attempt绑定grant/session/job/run/callId，不能只用每个新manager都从1开始的http-1做全局主键。checkpoint保存严格schema的原模型预算快照与定价版本，不保存Key或原始HTTP报文。

reserve/dispatch/checkpoint在同库写事务校验owner/fence、grant未过期/撤销、session绑定和累计额度。任意持久化失败，真实HTTP=0。跨轮次累计调用/token/used+held费用，不因新job、新manager、重启、授权重新提交或格式修复而归零。新grant不能隐藏旧unknown；同scope不允许通过换grantId并发绕过未清消耗阻断。

额度以独立的**sessionBudget**为真值，在创建live会话时固定币种、profile/定价版本及总calls/tokens/cost上限；保存它不授权付费。grant只能绑定该会话与相同profile，约束不得超过sessionBudget剩余额度。首版重新授权仅续期/撤销旧授权，不支持充值或扩大sessionBudget；新grantId同样累计原会话已结用量和全部held，不能再获得一份完整额度。当前有效授权版本由同库CAS切换，旧grant不能继续派发。跨会话的新预算也不能绕过profile中任何未清unknown。未来追加额度必须另设计显式有版本的额度变更，不藏在续期字段中。

实际usage只结算一次，重复checkpoint幂等，非单调/不同内容的旧检查点冲突。超用先完整记录再锁定，不能截成上限。账目保存宿主声明费率估算，与供应商正式账单分开。

重启恢复原终态和候选；reserved未派发释放、dispatched转unknown并保留预留。尚未结算的取消任务同样恢复账目，禁止自动重发。迟到usage只有当前有效owner可按原绑定结算，不能借机提交迟到模型答案。对账通过本地主进程受信入口显式提供证据/版本，普通模型工具无此权限。

## 6. 验证与分步交付

| 增量 | 必须通过 |
| --- | --- |
| v2迁移/存储 | 真实v1副本升级；内容/回执不变；unknown保留；备份失败、迁移中故障、较高版本、重复启动/旧fence拒绝 |
| 凭证帧/主进程SDK | 合成Key不进入stdout普通响应/通知、stderr、配置/DB/产物；拒绝重复/迟到/错grant回执；resolver错误脱敏；EOF/取消清理 |
| 本地live执行适配 | 真实Pi SDK＋注入HTTP完成双岗；显式live来源，Key缺失HTTP=0；预算写失败HTTP=0；限流/修复/压缩共享同一grant；无fixture兜底 |
| 崩溃与对账 | HTTP派发后中断保留unknown，重启不重新取Key/发请求；终态任务恢复账目；重复结算不重复收费 |
| 随包与真实验收 | 重建独立Bun产物、异cwd、合成resolver；最后另冻结在线批次，明确供应商/凭证来源/预算后才调用 |

本轮实现以离线注入/进程/迁移验收为界；在线批次另行准备。旧真实批次授权不自动续用；离线成功不能证明系统凭证库、真实模型质量、教学改善或供应商账单对账已验证。
