# 完整会话中的澄清与弃评

完整 workflow 的 `answer` 已使用 `evaluateTurnWithClarification`，不是只在单轮接口中演示。所有新增字段均可选，旧快照、旧离线 fixtures 和严格单轮 `evaluateTurn` 行为保持兼容。未调用真实模型，本页不证明评分语义准确。

## 状态与提交

1. `awaiting_answer` 收到回答。所有维度显式返回，必填维度合法 `null` 时，保存 `clarificationAttempts[] = { input, resolution, evidenceMode }`，revision 加一，继续 `awaiting_answer`。`state.version`、`turns`、观测和掌握度不变。
2. 前端读取当前题最新的 `resolution.status === needs_clarification`，展示 `resolution.clarification`。补充请求提交 **原文本逐字保留 + 非空追加内容**，新 `answer.id`、新 `context.runId`，保持 `observationId`、题目、rubric、状态、quality 和策略不变。不能把润色后的全文当作追加回答。
3. 完整评分只产生一个正式观测候选，状态 version 加一。澄清轨迹继续保留，以便恢复时核对原文前缀和冻结绑定。
4. 默认最多一次澄清、至少剩余 45 秒才继续澄清。再次证据不足或剩余时间不足时 `abstained`，`normalizedScore:null`。不构造 0 分，不创建观测，释放当前题，继续规划或按时间预算收尾。
5. `finish user_stop` 可以在等待补充时执行。报告将该回答列为未评分，不丢掉已有回答；只有已评分观测写入跨会话掌握记忆。只有弃评的会话不会追加一个伪空成长记录。

`clarificationAttempts` 是宿主保存的原文与 receipt，不是模型可随意覆盖的字段。receipt SHA 只做内容一致性，不能替代 API 归属、最新快照、任务 lease、存储 CAS 或运行取消校验。提交校验已增加“追加一条澄清轨迹但不改状态”的分支，恢复也重放冻结绑定、追加原文、次数/时间原因、发题顺序及最终评分连续性。

## 报告与证据范围

有未评分回答时，`report.unscoredAnswers` 包含 answer/question/skill 标识、status、reason、missingCriterionIds、evidenceMode 和 null 分数；`coverage.totalAnswers` 是已评分与未评分回答之和，`coverage.scoredAnswers` 和 `coverage.unscoredAnswers` 单独给出分母。已成功澄清后评分的同题只算一个回答，不将澄清次数当成题数。

`assessments`、`observedSkills`、掌握度、置信度、跨会话 memory 和 reflection 的评分证据仍只使用完整评分。报告 warning 明确指出未评分回答没有进入掌握估计。未答的题不计入已答覆盖。只含旧评分记录的报告不增加这些可选字段，避免旧签名/fixture 的无意义迁移。

语音补充若携带新的 speech，仍必须满足确认文本与本次累积回答的绑定；不能用一段只覆盖追加片段的录音伪装成全文的语音证据。已确认的未评分音频仍保留时序描述，表达覆盖分母包含全部已答题；内容弃评不等于音频未确认。恢复与报告重放会再次校验语音归属、确认文本和时间绑定。

## 可复现验证

Windows 项目根目录：

```powershell
& node_modules/@oven/bun-windows-x64/bin/bun.exe test tests/workflow-clarification.test.ts tests/session-workflow.test.ts tests/clarification.test.ts tests/workflow-commit-closeout.test.ts tests/workflow-delivery.test.ts
& node_modules/@oven/bun-windows-x64/bin/bun.exe run typecheck
```

新增 workflow 测试覆盖：待澄清重启恢复、禁止改写原回答、追加后仅一个观测、耗尽后继续不同题并评分、混合报告的真实分母、弃评不写 memory、用户中断待澄清、receipt 篡改、重算 hash 后的诱导提示注入、弃评题复测排除、弃评音频描述与恢复绑定、剩余 30 秒自动弃评。模型供给使用本地确定性 fixtures；这是机制和契约回归，不是线上质量或真实用户效果。

## 教学要点

- 业务 revision 与观测 version 是两个时钟：一次待澄清提交可以推进 revision，却不能伪造掌握观测。
- 空证据是未知，不是低分；合法 0 分需要真实、可定位的回答证据。
- 连续性要同时绑定题目、rubric、策略、原始状态和原文；仅检查 answerId 或 receipt hash 不够。
- 报告的回答覆盖与评分覆盖必须分别计算，否则少评分会被包装成高覆盖。
- “候选状态通过校验”仍不等于“业务 API 已正式提交”；CAS、lease、取消和幂等收据仍在原有业务边界。

