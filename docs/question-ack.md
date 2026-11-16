# 发题确认与重连恢复

业务API适配helper已实现；没有新增正式HTTP接口、Electron展示回调或数据库迁移。Agent的question.completed是候选事件，issuedQuestions[].content.text只记录待发文本。确认回执confirmationSource=client-reported表示客户端上报展示完成，不能证明真人阅读或理解。

## 接入顺序

1. API按[提交适配协议](workflow-commit.md)校验并提交plan候选，保留可信提交receipt和当前stored row。
2. 调用createQuestionPresentation({identity,stored,commitReceipt,deliveryId,now,existing?})。只接受当前awaiting_answer、完整content及绑定plan run/attempt的receipt，candidateDigest必须等于当前workflow摘要。返回独立sidecar候选，不证明输入真的来自数据库。
3. API以(userId,sessionId,questionId,planRunId,planAttemptId)唯一约束保存sidecar，与plan提交/首次创建保持事务一致性，再发送record.packet。并发创建冲突须重新加载已有记录；传入existing复用原deliveryId、文本和确认状态，不能每次重连生成新ID。
4. 客户端成功渲染packet后发送QuestionAckCommand。连接或SSE接收成功不自动生成确认。identity由API认证上下文构造，不能信任客户端归属、时间或记录。
5. prepareQuestionAcknowledgement返回未提交CAS计划。API事务检查最新workflow摘要/storageVersion及sidecar版本/完整摘要，原子写入next和receipt。宿主receivedAt记录请求接收时间；客户端时间不参与裁决。
6. 新确认要求当前题有效且now小于会话deadlineAt。相同commandId/clientInstanceId及全部绑定字段精确重试返回原receipt；已确认后换命令或实例属于冲突。旧题精确重放仅返回历史receipt，不附可操作packet，也不重新开放题目。
7. API可在提交回答前调用requireQuestionAcknowledged({identity,stored,record,now})。门禁需要显式接入，现有Agent answer没有自动启用。API应把检查与回答任务的当前题/版本绑定，防止检查后题目已变化。

## 契约与数据最小化

真值为packages/contracts/src/question-ack.ts，机器定义[question-ack-schemas.json](question-ack-schemas.json)，由bun run openapi:generate生成。服务端函数从@interview/agent-client导出，使用Node环境；renderer只消费共享schema及裁剪后的packet。

学生packet仅含deliveryId/sessionId/questionId/roleId、text/textDigest、issuedAt/expiresAt。不含用户ID、量规、评分锚点、知识回执、模型上下文、plan run/attempt或lease。text可能包含学生此前回答短摘录，API仍须验证归属并限制日志访问。

textDigest使用workflowCommitDigest(text)：规范JSON序列化后的UTF-8字节做SHA-256，不是直接对原始文本字节散列。摘要检查一致性，不是认证、签名或真人展示证据。内部contentDigest与workflowDigest另绑定完整发题和快照。

sidecar.version从0到1；确认不修改Agent workflow revision、能力状态、报告或模型历史。SQL应使用唯一约束、条件更新和同事务receipt，不能拆成无锁的先查再写。现有db/schema没有对应存储映射，公开可计算的hash不提供授权。

## 恢复与错误

resumeQuestionPresentation({identity,stored,record,now})不调用Agent或模型。当前且未过期时返回原packet，status区分awaiting-ack/acknowledged及shouldAcknowledge。已确认当前题可恢复界面，无需新确认命令；不保证界面恰好展示一次。

不处于待回答、旧快照缺content、sidecar缺失、过期或绑定变化时，返回unavailable及not-awaiting-answer/legacy-content-missing/unregistered/expired/stale，packet=null。不补造文本或确认。仅storageVersion增加而workflow不变时可复用sidecar，但旧CAS计划仍拒绝，须针对新storageVersion重新prepare。

静态错误均带PRESENTATION_前缀：VALIDATION_ERROR、BINDING_INVALID、FORBIDDEN、EXPIRED、CLOCK_INVALID、OPERATION_CONFLICT、STALE、NOT_ACKNOWLEDGED。错误不包含正文或内部消息，也不能替换为展示成功。

## 演练与验证边界

bun run agent:question:ack:demo经进程内HTTP/SSE、真实Pi SDK及固定provider完成两岗各两题：plan内存提交→packet→JSON写盘读回→脚本确认→sidecar内存CAS→写盘恢复→精确重放→回答门禁→报告。加--tcp走本机端口。输出scope=scripted-client-api-cas-fixture、formalCommitted=false、actualGuiVerified=false、liveModelCalls=0。

确认由脚本模拟客户端，不能当作Electron已渲染、正式用户鉴权、SQL事务回滚或生产崩溃恢复。正式API/GUI确认与持久任务恢复仍需后续联调。
