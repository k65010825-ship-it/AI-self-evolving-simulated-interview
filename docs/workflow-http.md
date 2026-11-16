# 会话编排内部HTTP/SSE联调

## 调用边界

完整会话现在可通过既有Agent内部runs接口远程执行，不新增正式session store。业务API持有可信会话快照/修订号、学生身份、任务和提交资格；Agent每次只返回一个新候选。内部run.completed与会话phase=completed均不代表数据库提交，committed固定false。

开发启动：AGENT_MODE=offline-fixture，设置独立AGENT_INTERNAL_TOKEN；需要模型规划时AGENT_PLANNING_MODE=pi-knowledge。默认deterministic下其他操作可执行，但需要模型的workflow plan会进入DEPENDENCY_UNAVAILABLE失败快照。宿主纯收尾不需要模型，即使缺规划依赖也能结束。

`bun run agent:workflow:http:demo`在本机随机端口实际演示两岗create→plan→answer→plan→answer→finish→原finish重试→restore，读取SSE及候选快照。真实SDK、本地手工provider，真实模型/ASR调用0，不保存正式数据。模块20的宿主函数说明见[会话契约](session-workflow.md)。

## 请求与操作

业务后端现在可使用私有workspace包@interview/agent-client，封装调用/响应关联、事件续订和错误；见 [SDK接入](agent-client.md)。仍须自行维护正式任务与CAS，不直接复制演示服务器。

所有请求仍需服务Bearer token，路径不变：POST /internal/v1/runs（202）、GET /internal/v1/runs/{runId}（200）、GET events（SSE）、POST cancellation（202）。具体机器契约见[内部OpenAPI](agent-openapi.yaml)和[运行schema](agent-runtime-schemas.json)，真值为contracts/workflow-job.ts与agent-run.ts。

根请求为`{inputSnapshotId,context,job:{type:'workflow',operation}}`。context包含userId/runId/attemptId/roleId/deadlineAt，inputSnapshotId由API分配并持久保存；Agent不验证数据库引用或来源签名。五种operation：

| action | 字段 | 行为 |
| --- | --- | --- |
| create | config:CreateWorkflow | 新建ready_to_plan候选；config.now不得晚于Agent当前时间 |
| plan | snapshot:Workflow，command:PlanQuestionCommand | 先恢复校验，首题/下一题或ready_to_close |
| answer | snapshot，command:SubmitWorkflowAnswer | 从current绑定题目/量规并评估确认文，可附speech |
| finish | snapshot，command:FinishWorkflow | 完整报告/记忆/反思候选，不自动发布策略 |
| restore | snapshot | 重验身份、发题时序、历史及完成包；不恢复执行中的SDK任务 |

根context用户/岗位必须匹配create身份或snapshot身份；plan/answer的command.context必须与根context完全一致，包括runId/attemptId/deadlineAt。plan/answer/finish的command.identity也要匹配根身份。违背结构/绑定在接受前返回422，不创建运行。上下文与config.now应由同步时钟的可信服务器生成，不能使用学生本机时间或自报身份。

每次新操作使用新runId和inputSnapshotId，attempt标识当前执行。相同runId同归一化请求幂等复用；同runId换快照、命令、attempt或其他字段返回409。收尾在新runId上重试时可以原样使用原finish命令的expectedRevision，完成包按宿主规则保持冻结。

## 结果、事件与错误

成功GET结果：`{kind:'uncommitted-workflow-result',action,snapshot}`，snapshot是新Workflow完整候选，包含baseMemory、原输入、评分、回执和可能的closeout，仅供内部服务使用。不得直接传给renderer，学生可见内容由API鉴权和裁剪。

新阶段包括workflow_creating/validating/planning/evaluating/closing/restoring。候选通过结果schema与最终预算检查后，事件新增workflow.updated，payload只有action/sessionId/revision/phase/stateVersion；成功plan可再发question.completed，仅含题目。最后run.completed携带resultKind及committed=false，不通过SSE传输完整快照、原文、量规、记忆、反思或SDK思考。

Last-Event-ID和afterSeq、断线退订、旧attempt取消、超前游标、终态保护沿用已有运行协议。GET快照是结果来源，不靠SSE内容自行拼出正式会话。断开订阅不取消任务，显式cancellation才撤销本次候选执行；超时/取消后迟到结果不产生workflow.updated或成功候选。

202只是接受。旧修订/错阶段、恢复篡改、缺模型依赖或执行失败，可能在202后表现为run.failed及error，result=null；分别使用VERSION_CONFLICT、VALIDATION_ERROR、DEPENDENCY_UNAVAILABLE等静态目录码。业务API须检查run.status和result.kind，失败时不能CAS提交。不会把供应商原始错误或私密token返回。

## 后端提交顺序

1. API认证学生并加载受保护快照，持久保存本次任务、输入快照和expectedRevision。
2. 调Agent接受运行，持久保存run/attempt引用，订阅事件或查询运行快照。
3. 运行completed且结果匹配后，API验证任务租约/归属/输入版本，以原revision进行CAS提交新候选。
4. finish包还要按原baseMemory.version提交记忆，报告/反思/会话状态应在API事务内一致保存；Agent的候选原子性不代替该事务。

从同一旧快照创建两个不同run都可能计算成功，Agent不做跨run会话锁，最终API只能接纳一个版本。恢复结构一致也不等于来源真实，身份与时间来源仍由API保证。

## 资源与尚未实现部分

HTTP请求及直接run请求保持最多2MiB UTF-8 JSON。纯宿主Workflow最多8Mi UTF-16字符并不等于HTTP能传8Mi；较大的回答/音频描述/历史可能被413拒绝，不能靠改inputSnapshotId省略实际快照。暂未实现数据库快照引用加载、压缩或大文件上传。

默认32条内存run记录、4个活跃任务、单run30秒；宿主操作及Pi适配器有自身更小预算。记录不自动清理，满后429，重启丢失运行、事件和幂等记录。该开发入口不提供生产任务恢复或多实例会话提交语义。

真实模型/ASR质量、麦克风、GUI、Windows安装、数据库事务、正式业务HTTP与学生侧端到端体验仍需独立联调验收。


## 会话收尾后的 RSI 实验

内部 runs 新增 `job.type=rsi`，输入完整已收尾 Workflow 和实验快照，返回 `kind=uncommitted-workflow-rsi`。SDK 支持执行与安全事件订阅；SSE 只输出合成聚合指标。离线实验可激活、拒绝或重放，原会话策略不变；下一场 pin 仅预览、未写正式库。来源校验、隔离规则、回滚重放及接口字段见 [会话收尾与 RSI 离线实验](workflow-rsi.md)。

完整workflow的plan现可进入presenting阶段，并在question.completed附带delivery；首题保持原题。结果快照的issuedQuestions[].content保留待发题文本及原题/量规/来源绑定，后续answer和报告沿用该文本。它仍是未提交候选，业务API需先校验归属、租约、时间和CAS，再裁剪转发；事件送达不等于学生展示确认。
