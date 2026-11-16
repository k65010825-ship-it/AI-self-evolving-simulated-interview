# 验证目标新版本提案（默认不加载）

本目录保存Java并发容量、Web列表渲染两题的独立新版本草案。`loadKnowledgeWorkspace()`仍只读原seed/expansion，当前24题、0条人工批准及历史记录不变。新版本不能混入现有默认题库，也不能通过修改draft标记获得批准。

- workspace.json：两条候选、原维度权重/新验证锚点、档案及来源版本；reviews为空。
- manifest.json：原题版本/内容摘要、提案身份、MarkItDown MCP一手来源读取记录与正文摘要哈希。哈希不提供来源身份认证。
- alias-cases.json：24条AI合成开发数据；20条规则回归、4条已知风险。标签表示“可进入结构化评分”，不是“答案正确”。相关错误过程仍可能评0。

`bun run knowledge:verification:review`导出新的`.cache/verification-knowledge-review/run-*`目录，包含自包含packet.json、alias-calibration.json、空review-template.json和review.md。导出会复算摘要与校准，不执行任何正式批准、知识替换或策略发布。

当前两岗均有潜在误放行1/5负例、误弃评1/7正例，只对本AI开发标签成立；已知风险不混进20条回归的通过分母。这些不是生产质量指标，也不是独立保留测试集。修改别名后须重新冻结提案与案例；不可只删掉失败样例或修改标签以追求全绿。

技术参考：[Java SE21 AtomicInteger](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/atomic/AtomicInteger.html)、[React Profiler](https://react.dev/reference/react/Profiler)。官方API语义不背书原创测试方案、题目锚点或学生学习效果。候选适用前提与局限写在dossier中；独立岗位审核与正式权限仍另行处理。
