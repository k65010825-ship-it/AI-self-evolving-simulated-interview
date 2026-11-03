# 岗位知识维护入口

每岗seed保留4题，expansion新增8题；全部24题仍为draft。来源读取、结构可审核和人工批准是三个不同状态。当前真实审核账本为空，不要改reviewStatus伪造批准。

先执行`bun run check:knowledge`，再执行`bun run knowledge:review`查看逐题审核包。编辑题目时同步版本、dossier和引用；内容/来源变化会使旧批准失效。具体字段、逐项检查、默认封闭访问和正式发布边界见[审核流程](../docs/knowledge-curation.md)。

只保存链接及原创概括，不导入第三方全文或真实学生数据。source-checks记录实际读取，不能用脚本日期更新冒充重新访问。reviews只由实际审核者在完成检查后维护；测试中的合成批准不是人工成果。
