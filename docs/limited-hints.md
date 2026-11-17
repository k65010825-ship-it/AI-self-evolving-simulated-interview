# 限次提示：Agent实现与验收边界

本模块为固定两级coaching-v1引导，不是模型生成参考答案。technical/project/scenario/behavioral各有拆解与深化引导，零供应商调用；不读评分答案、凭证或任意URL。内容适用性仍待真实学生和岗位人员审核。

## 代码分层

- contracts/hints.ts：严格输入、稳定issue、journal、回执及辅助标记；128操作/题、两次committed、一次reserved，校验完整转移历史和版本。
- hints/limited-hints.ts：纯reserve/commit/release/recover，derive成功次数；成功重放在限次检查前，released操作不可重新执行。模板版本固定。
- local/hint-host.ts：从受信workflow计算issue，校验当前题/revision/deadline/busy/unknown，通过repository端口预占、生成模板并正式提交。模板生成在事务之外，整个执行同步，不启动模型或异步后台任务。
- local/host.ts：注入profile、事务/围栏、session读取及正式辅助标记提交；stdio只暴露hint.status/request。默认无repository时明确禁用，不退化成进程内Map。

## 正式提交与恢复

计数作用域不依赖变化的workflow revision。正式提交在同一profile事务写journal成功回执、workflow hintAssistance、revision+1及storage_version+1；任一写失败整笔回滚。客户端成功后重读session使用新revision，重放receipt不增revision。旧receipt的remaining是原提交时值。

启动只释放reserved模板任务，保留committed；不删除账目、不重发收费调用。原成功操作在限额耗尽/换题/完成/过期后仍可重放。未知模型消耗独立阻断新操作，提示预占释放不能清unknown。HintRepository的真实实现/迁移由DB同学交付，端口接线与纯恢复已实现；SQLite临时测试表不是产品repository。

宿主持有workflow辅助标记，即使后来未注入repository，后续答案仍带辅助属性；有repository时必须与journal成功记录完全一致，丢失历史不能创建空计数。业务/语音操作也拒绝重复使用成功提示ID；无repository时已释放而未提交的提示ID仍需原repository才能定位，恢复依赖缺失不表示历史日志完整。

## 证据隔离

辅助属性从宿主注入命令，提交门控校验输入/观测一致；澄清冻结哈希不含可增长的辅助字段，单独要求同issue、同版本、receiptIds前缀只增不减。workflow恢复同时校验辅助记录与回答，模型不能删除它来提交独立答案。

练习分继续显示但带assistance。评分观测/报告/记忆保留标记，独立mastery/confidence/难度递进、历史召回与学习预测/复测配对排除辅助证据；历史保留题目暴露，不能因排除能力分再次当成新题。含辅助作答的来源会话不生成RSI候选，保留可解释发现。历史审计单列assistedExcludedCount，不能把“旧量规未固定”误说成“所有历史都独立可用”。旧记录无标记仍是legacy，不补造独立性证明。

## 离线验收

`bun --no-env-file test tests/hint-limits.test.ts tests/hint-evidence.test.ts tests/local-hints.test.ts tests/local-stdio.test.ts`。

覆盖双岗位、上限与串行预占、失败释放、恢复/ACK重放、空repository拒绝、模板提交失败整笔回滚、缺依赖仍辅助、丢历史不清零、语音ID冲突、unknown不释放、跨会话记忆与RSI隔离。仅证明工程机制，正式repository与真实提示质量未验收。
