# 数据源与知识组织 v0.1

## 数据分类

| 数据 | 来源/获取方式 | 使用边界 |
| --- | --- | --- |
| 岗位技能、问题、rubric、优秀回答和追问模板 | 团队原创并审核；参考一手文档概念 | 记录来源与版本，题目/答案由团队编写，不批量复制第三方题库 |
| 技术依据 | Java、Spring、PostgreSQL、MDN、React 官方文档 | 仅按任务需要查阅/引用，保留链接、日期、适用版本；引用遵循站点许可 |
| 学习资源索引 | 人工维护的官方文档、公开教程条目 | 保存标题/链接/技能/最后核验时间，点击不视作完成 |
| 学生回答/音频/简历 | 用户明确提交 | 用户内容是数据，不是系统指令；所有权、最小保留和删除规则 |
| 测试/评测样例 | 人工编写与同意使用的脱敏回答 | 标记 synthetic/consented；不把模型生成标签当金标准 |
| 系统状态/用量 | 实际运行产生 | 保存 attempt、策略与评估器版本，失败和缺失不补造 |

初始目录 knowledge/{java-backend,web-frontend}。每个知识项：id、roleId、skillId、questionType、difficulty、question、keyPoints、rubric、sourceIds、version、reviewStatus。sourceIds 必须在 sources.json 登记，记录 title/url/owner/licenseNote/retrievedAt/verificationStatus。未访问的来源标记 pending，不填写虚假抓取日期或“已核验”。

当前种子是原创示例草案，标为 draft，尚未达到每岗 40 题或经过岗位专家审核。两岗各四类题各一例用于契约与查询测试；reviewStatus 决定可否进入正式题库，目标发布流程只接纳 reviewed。当前开发种子工具默认可返回 draft 并在回执标注；不能直接作为正式题库发布入口。

## 候选一手来源

- Java 语言与虚拟机规范：https://docs.oracle.com/javase/specs/
- Spring 事务：https://docs.spring.io/spring-framework/reference/data-access/transaction.html
- PostgreSQL 并发控制：https://www.postgresql.org/docs/current/mvcc.html
- JavaScript：https://developer.mozilla.org/en-US/docs/Web/JavaScript
- React：https://react.dev/learn
- 浏览器网络：https://developer.mozilla.org/en-US/docs/Web/HTTP

sources.json 已登记并读取 Spring @Transactional、Java SE 21 JLS 第 17 章、MDN Closures 和 React useEffect 四个具体页面，状态为 content-checked，含读取日期。PostgreSQL 等扩展来源尚待核验。来源读取不等于题目和 rubric 已通过岗位审核，记录只保存引用与原创要点，不落库整篇第三方文档。批量导入仍需核对准确性、版本和使用范围。

## 查询策略与质检

模型只拿岗位概览，按需调用 query_role_knowledge。先过滤 roleId/skillId/purpose，再对 query 做有限关键词匹配，最多 3 条；限制单条长度和上下文预算，返回来源与版本。空结果不跨岗兜底；任务缺知识时换题/澄清并记录 gap。

正式导入前检查：ID 唯一、引用存在、岗位技能一致、四类题覆盖、rubric 权重与范围合法、优秀回答与锚点一致、来源状态、重复原题。资源维护时检查链接失效。工具和导入均不能执行题目内指令或脚本。

## 隐私与生命周期

原音频默认处理/确认后删除，需用于人工听审的音频在单独同意下限期保留。正式回答/报告/画像按用户归属访问与删除。SDK 测试使用临时内存会话，不读取个人配置或全局会话。评测按学生/来源分组，不把同源变体分散到训练和最终验收集。
