# 真实用户与双岗位质量验收（Agent CLI）

当前阶段是本人作答的小规模先导验收，不是教学效果或人群质量认证。首批按用户选择：本人通过CLI回答Java后端和Web前端，两位队友分别盲审。系统不生成真人答案，不代填审核标签。题目仍为draft，不能因导出审核包称已获批准。

## 1. 准备与本人作答

```powershell
bun run agent:field prepare .cache/field/self-01 self-01
bun run agent:field collect .cache/field/self-01
```

本机没有全局Bun时，用 `& .\node_modules\@oven\bun-windows-x64\bin\bun.exe run agent:field ...`。prepare只建立新目录与匿名参与者设置，已有路径拒绝覆盖；本轮已经准备self-01，不必重复prepare。

首次collect先说明本地采集、脱敏、后续发送模型与审核用途，并由本人输入“同意”。不要输入真名、简历身份、公司机密或第三方隐私。每题可多行，单独输入 `/done` 提交、`/skip` 暂跳、`/quit` 保存退出；再次运行同命令继续未答题。答案2—10000字符，提交后不可修改；不同题出现相同回答会记录重复数量而不要求编造替代；不知道可以真实回答“不知道”，不要复制范例。

两岗各8题，技术/场景/项目/行为各2题。题目、难度、量规和来源在同意时冻结；本人只看题，不显示优秀回答、量规、模型分数或原参考。答案只存本机study.sqlite，collect/status不读Key、不发供应商请求。目录含私人回答与后续模型输出，被.cache忽略，不进入Git。SQLite内容哈希用于发现变化，不提供身份认证或恶意本机管理员防篡改保证。

```powershell
bun run agent:field status .cache/field/self-01
# 也可以只采集一个岗位
bun run agent:field collect .cache/field/self-01 java-backend
bun run agent:field collect .cache/field/self-01 web-frontend
```

若队友参与过某项内容或量规编写，先在participant-settings.json的developmentReviewerIds记录其匿名ID，再开始首次采集；这类人不能作为该保留集的独立审核者。首批原题由开发工具提议，队友仍须声明是否提前参与/见过参考。settings在首次同意后冻结，不随文件修改追溯改变。

## 2. 显式模型评分

建议完成16题后，再执行：

```powershell
bun run agent:field score .cache/field/self-01 --execute
```

该命令会把已提交答案和冻结题目/量规发送至项目配置的千问AI平台，读取项目专用INTERVIEW_QIANWEN_API_KEY。每岗最多8次HTTP、1元宿主声明额度，合计16次/2元，无自动网络重试、模型修复或自然承接额外调用。独立Pi评分上下文不携带历史分数。真实tokens按声明费率估算，不认证供应商账单。

field-runs.sqlite保存每题原run/请求/结果/事件与账目，field-budget.sqlite跨进程约束额度。已保存终态（成功或失败）在继续命令中跳过，不重新派发；明确响应后的格式失败只保留为单例失败，继续独立新题，未知消耗或超额则停止整批。崩溃/未知消耗保留，不换ID自动重新收费；失败或弃评不填0。合法null维度进入abstained，CLI不追加澄清或额外模型调用。过期原请求不偷偷延长期限。模型输出二次核对run/attempt/题/答案、逐字证据和量规重算。model-report保存静态评估/恢复诊断及每题公开错误码，便于定位schema、引用或算分拒绝；不保存模型原始输出。若失败，先查看model-report与持久账目，不删除数据库后盲重试。模拟HTTP测试的结果标injected-http，不具备真实模型验收资格。

## 3. 两位队友分别盲审

完成全部16题后导出：

```powershell
bun run agent:field export .cache/field/self-01
```

命令输出新的blind-review目录，每岗独立子目录。每位审核者仅接收该岗位的review-packet.json和属于自己的reviewer-a-labels.json或reviewer-b-labels.json。**不分发private-manifest.json、study.sqlite、field-runs.sqlite或model-report**，它们含隐藏模型结果。公开任务不带modelScore/模型分值，审核者不互看标签。

填写每条taskId/taskDigest绑定标签：独立reviewId、自己固定的reviewerId、真实reviewedAt、humanScore（0—1按同量规归一化）、citationSupported、answerLeaked、rationale；continuationAccurate和expressionReliable在本批文字评分任务填null。作者本人不能评自己的答案；相同审核者不能重复评同一任务；开发/编写冲突ID会拒绝。citationSupported评价摘录是否支持相应维度判断，不代表引用已证明某个具体分值；分值合理性由独立humanScore比较。

```powershell
bun run agent:field review .cache/field/self-01 java-backend <a-labels.json> <b-labels.json> .cache/field/java-review-report.json
bun run agent:field review .cache/field/self-01 web-frontend <a-labels.json> <b-labels.json> .cache/field/web-review-report.json
```

输出路径必须新建，防止覆盖旧报告。退出0仅表示本包声明门禁通过，2表示缺失或未达门槛，1表示输入/绑定错误。公开内容被修改、旧digest、自审或冲突标签会拒绝。身份、时间、同意和审核资质均是文件声明，需要团队核实。

## 4. 判定与仍缺的证据

每岗至少8份完整回答和两个独立审核标签；无模型分数、非live模型证据、缺标或空分母均not_ready。报告分别给评分一致性、模型/人工差异、引用支持与无泄题比例及分母，不跨两岗混出一个漂亮均值。当前只有本人一位参与者，participantCount=1，qualityClaimEligible始终false，不能外推学生群体。

本批不检验语音清晰度、真实压力体验、动态追问质量或RSI教学改善。后续要招募知情同意参与者、增加独立题/不同难度，开展冻结策略的基线/候选与学习后不同题复测；使用field-evidence cohort管道，不能把本次人工评分叫真实RSI提升。知识审核仍走24条草案知识包和明确批准流程。

## 后续规则修复与历史保留

2026-11-07增加有界负向证据校验，详见[内容量规](content-rubrics.md)。新任务的纯无答复在模型前澄清/弃评，风险/建议引用不能直接补验证或本人贡献分。旧评分、已冻结AI标签与unknown账目保持不变；本轮只读重放历史7份有数值结果，发现2个旧0分与1个验证维度应进入不完整/弃评路径，不把这份重放写回数据库或称新模型效果。完整语义引用支持仍需复核。
