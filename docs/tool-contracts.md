# Agent 工具契约 v1

状态：已实现只读种子知识查询、上下文构造、技术/行为内容评分计算器、资源目录查询及 Pi 包装。评分/资源需宿主显式接入，默认会话仍只注册知识查询。真实模型语义质量与正式提交未验证/实现。

## 共同边界

公共 schema 在 packages/contracts/src/tools.ts，Pi TypeBox 包装在 apps/agent/src/tools/pi-knowledge-tool.ts。Zod 是业务输入/输出边界的真值来源，Pi 使用由其 JSON Schema 派生的参数声明；工具执行时仍实际 Zod 校验。执行 bun run openapi:generate 同时生成 docs/tool-schemas.json；工具不是公开 HTTP 端点，故单独输出工具 schema。

宿主注入 ToolContext：userId、runId、attemptId、roleId、deadlineAt。工具计数器由当前运行的执行器持有。上述字段不是模型参数；知识查询仅允许当前 run 的岗位。未来读取画像时还必须根据 userId 检查所有权，不接受模型自报身份。

回执：callId、toolName、status（ok/empty/error）、sourceIds、durationMs，成功时 data，失败时 error={code,message,retryable}。空结果为 empty，区别于失败；sourceIds 必须来自实际记录，不能由模型发明。日志按 run/attempt/call 关联，不记录密钥、完整音频或内部推理。

## query_role_knowledge（本轮种子实现）

输入：

| 字段 | 类型与约束 |
| --- | --- |
| roleId | java-backend 或 web-frontend；必须等于上下文岗位 |
| skillId | 非空，最多 80 字符 |
| purpose | questioning 或 scoring |
| query | 可选检索词，最多 200 字符 |
| limit | 1—3，默认 3 |

不接受任意 URL、文件路径、SQL、userId、权限或评分权重。先验证输入和岗位权限、取消、期限、调用预算，再读取版本化记录；合法执行无论命中或空结果都消耗一次预算。invalid/forbidden 不是扩大搜索范围的理由。首版预算在单个受控 run 内原子计数，跨进程任务恢复的预算持久化在 API 后续任务实现，不能宣称已有分布式预算。

输出 data={items:[KnowledgeItem]}；每项包含 id、roleId、skillId、questionType、difficulty、question、keyPoints、rubric、sourceIds、version、reviewStatus。此工具从登记过的只读知识库返回数据，不在运行时任意抓取互联网。

错误：VALIDATION_ERROR、ROLE_FORBIDDEN、RUN_CANCELLED、DEADLINE_EXCEEDED、TOOL_BUDGET_EXCEEDED、DEPENDENCY_UNAVAILABLE。授权、取消、预算错误不自动重试；只读临时依赖错误可由统一调度器在剩余预算内重试，工具自己不叠加重试。

## search_learning_resources（目录查询已实现）

输入 roleId、skillId、level；数据来自经维护的 ResourceRecord（id、title、url、provider、skillIds、lastCheckedAt、reviewStatus）。仅返回 allowlist 中的资源，URL 在导入/维护时核验；工具不接受任意抓取目标。点击、学生自报完成、可核实练习完成分别记录。失效资源返回不可用，不伪造替代链接。

公共schema为packages/contracts/src/resources.ts。level=foundational/intermediate/advanced，limit=1—3默认2；严格拒绝URL、身份或额外权限字段。宿主注入ToolContext及目录快照（version、allowedHosts、items），条目包含岗位/技能/等级、来源ID/版本、审核/可用/核验状态与毫秒时间lastCheckedAt。URL仅精确主机名allowlist、HTTPS、无用户凭证或非默认端口；运行时不联网，不能证明以后重定向目标或页面持续可用。该边界是受控导航元数据，不是任意抓取工具。

默认仅reviewed、available、content-checked且核验时间不在未来/30天内的条目；宿主可调有效期，最长365天。草案只允许宿主显式allowDraftResources；不改变审核态。精确匹配岗位/技能/等级，不降级兜底，按核验时间新到旧、ID稳定排序。未命中或失效条目不返回，工具status=empty；数据目录应在维护侧记录失效原因。

默认预算5次；合法空结果也消耗预算。查询前后检查取消/期限，错误遵循公共目录。回执含toolName=search_learning_resources、status=ok/empty/error、sourceIds、durationMs及data{catalogVersion,items}。真实返回来源只来自目录，目录导入质检核对sources.json。Pi包装位于tools/pi-resource-tool.ts，默认未注册；评估会话保持无工具。

## compute_rubric_score（离线计算执行器已实现）

输入 rubricId、rubricVersion、criterionScores[{criterionId,score,evidenceIds}]。权重、范围和必填维度来自服务器固定 rubric，不允许模型传任意权重。输出分维分数、归一分、缺失维度、规则版本。缺失表达音频维度保留 null，不填零。未匹配证据或非法范围拒绝，不能默默截断后当成有效评分。

契约真值见 packages/contracts/src/scoring.ts；执行器为 apps/agent/src/tools/scoring-executor.ts。宿主额外注入 answerId、answerText、evidence[{id,start,end,excerpt}] 和 rubric 定义；偏移按 JavaScript UTF-16 单位，摘录必须严格等于原文切片。工具只验证出处与计算规则，不验证摘录是否足以支持语义评分。模型不能新增证据或改权重。Rubric 的维度 ID 唯一、权重和为 1；配置解析时复制，后续外部修改不影响运行。

归一分 = 已观测维度的 Σ(weight × score/maxScore) / coverageWeight。必填项缺失拒绝，可选项缺失保留 null；complete=false 时是局部分，不得直接与完整分比较。所有可选项均缺失时 status=insufficient_evidence、归一分=null。输出 scope 随宿主量规为 technical-content 或 behavioral-content，不包含音频/情感或完整面试总分。演示中的两岗 draft-1 权重仅是可运行样例，未校准。

回执 toolName=compute_rubric_score，status=ok/insufficient_evidence/error，data 包含 answerId、rubricId/version、scope、dimensions、normalizedScore、coverageWeight、complete、missingDimensions。错误复用公共目录；增加 NOT_FOUND、VERSION_CONFLICT。默认每执行器 5 次，合法岗位与版本查找后的语义失败也消耗预算；取消/过期先拒绝。预算是进程内，非跨运行持久限制。执行 bun run agent:scoring:demo 验证手工输入成绩的算术，不代表真实模型评分准确。

## 上下文构造（宿主函数，非模型工具）

apps/agent/src/context/build-context.ts 的 buildInterviewContext 接受状态、时间、目标、阶段、回答和候选知识。固定 system policy 与 JSON 数据载荷分离；载荷只含派生累计能力、剩余时间等必要字段，不包含 sessionId/userId 或原始历史。回答内容自身仍可能含个人信息，不能宣称已完成脱敏。

默认总预算 8000 UTF-16 单位，回答 4000、每条知识 1200、最多 3 条。预算计算包含 JSON 转义后的 systemPrompt+userPrompt，不等于模型 token 上限。跨岗位知识拒绝，重复/非当前技能/draft 默认丢弃；草案必须显式 allowDraftKnowledge。知识携带来源、版本、审核态及截断标记。提问阶段可截断回答并标记，评分阶段不能静默截断；必要状态或评分回答超预算返回 CONTEXT_BUDGET_EXCEEDED。审计返回入选/丢弃 ID、实际字符数，不记录回答正文。提示词隔离不保证消除注入，执行器权限检查仍必需。执行 bun run agent:context:demo。

## 重试和副作用

当前所有已注册工具只读。不把任何 SDK 工具结果直接作为正式业务提交。评分、下一题和画像由 API 在 attempt/sessionVersion 检查后事务提交。未来新增写工具须单独定义幂等键、所有权、取消竞态和未知执行结果，不沿用只读重试策略。
## 扩充知识目录与审核闸门

query_role_knowledge的模型参数不变；宿主可显式选择curated目录。data除items外可含guidance（返回itemId绑定、资料版本、适用条件、追问及sourceId/version/locator）；questioning不附answerGuide，scoring才附。guidance仅对应实际返回条目，角色/预算/Top-K和规划筛选仍有效。旧seed模式不含此字段。

默认curated reviewed-only为空时不回退草案。正式身份审核与发布仍属于API，文件声明不是认证；细节见[知识扩充与审核](knowledge-curation.md)，机器契约由packages/contracts与生成Schema维护。
