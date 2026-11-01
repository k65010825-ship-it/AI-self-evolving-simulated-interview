# Agent 工具契约 v1

状态：本轮实现只读种子知识查询执行器与 Pi 工具适配；资源检索/评分计算在此定义，未实现不得注册或返回伪造成功。

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

## search_learning_resources（契约，未实现）

输入 roleId、skillId、level；数据来自经维护的 ResourceRecord（id、title、url、provider、skillIds、lastCheckedAt、reviewStatus）。仅返回 allowlist 中的资源，URL 在导入/维护时核验；工具不接受任意抓取目标。点击、学生自报完成、可核实练习完成分别记录。失效资源返回不可用，不伪造替代链接。

## compute_rubric_score（契约，未实现）

输入 rubricId、rubricVersion、criterionScores[{criterionId,score,evidenceIds}]。权重、范围和必填维度来自服务器固定 rubric，不允许模型传任意权重。输出分维分数、归一分、缺失维度、规则版本。缺失表达音频维度保留 null，不填零。未匹配证据或非法范围拒绝，不能默默截断后当成有效评分。

## 重试和副作用

当前所有已注册工具只读。不把任何 SDK 工具结果直接作为正式业务提交。评分、下一题和画像由 API 在 attempt/sessionVersion 检查后事务提交。未来新增写工具须单独定义幂等键、所有权、取消竞态和未知执行结果，不沿用只读重试策略。
