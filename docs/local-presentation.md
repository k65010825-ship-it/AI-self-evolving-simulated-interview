# 本地会话与报告展示投影

基于现有profile v3已提交workflow/closeout，只读生成前端DTO，不新增迁移/repository或模型调用。公共接线见local-runtime-api.md；实现为apps/agent/src/local/presentation.ts，契约为packages/contracts/src/local-presentation.ts。

会话get暴露同题澄清原文前缀、唯一作答题数、最后一题反馈；list显式summary且不重复传完整报告。session.answers/report各最多5题，revision固定分页，旧页混入新状态时拒绝。SDK四个读取helper严格验证数据。

评分结果按原数值保留0/null；原始proposal.feedback不能直接给UI，复用projectFeedbackPublication门控。criteria仅输出固定维度名称/分数，action为空；studyPlan按改进目标映射宿主安全模板，不转发criterionFeedback生成的要求/锚点，不暴露量规描述或工具回执。证据与answerId和UTF16偏移绑定，每题3条/每条240字符；裁剪与遗漏显式报告。semanticSupport保持not_verified，不把引用存在当成人工质量通过。

报告从原turn和closeout生成，无新正式状态；按题展示，保留rubric版本/范围，不对不同量规强行平均。列表summary的report=null须结合hasReport判断。新功能不需要后端先新增表；后续提示、画像趋势、六技能及学习复测的存储适配按数据库交接清单执行。

验证入口：bun --no-env-file test tests/local-presentation.test.ts tests/local-presentation-stdio.test.ts。纯投影覆盖澄清/弃评/零分、隐藏反馈/错误证据、分页/版本与大Unicode载荷；双岗真实stdio/临时SQLite覆盖SDK读取与重启无额外执行，畸形返回只报固定码。固定provider半分不是语义判定，不能以“我不会”等文字推断其fixture必会弃评；弃评分支用独立不足证据注入测试。测试不接真实供应商、不验收桌面或评分语义。
