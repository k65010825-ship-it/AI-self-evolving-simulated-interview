# 状态约束的自然提问呈现

本模块把已选中的技术题与上一轮回答连接起来：AI只生成简短承接语，宿主逐字追加原题。岗位、技能、难度、题目ID、知识版本和评分量规保持既有选题结果，不开放自由改写技术问题。产物仍是未提交候选，不是正式发题或语义安全证明。

## 开发入口

`bun run agent:question:demo`使用真实Pi SDK、本地固定provider和明确的手工状态观测，演示Java/Web两岗；不调用真实模型。共享真值为`packages/contracts/src/question-delivery.ts`，机器定义见[question-delivery-schemas.json](question-delivery-schemas.json)。宿主编排位于`questioning/deliver-question.ts`，Pi适配器位于`adapters/pi/question-delivery.ts`。

live配置`questionDelivery`默认`canonical`，默认请求/事件行为不变。显式`natural-bridge`才在成功评分、选到题目后调用呈现模型；完整验收每岗最多4HTTP（评分1、知识规划2、呈现1）。需按[模型接入](model-access.md)配置授权/期限、调用数/总token/费用；原3次样例不足以通过带呈现的完整验收。接口不接受学生传模型/URL/凭证或预算。

## 输入与职责

宿主输入context、更新后的累计state、已核验selection、上一轮完整answer及pin的wrapUpSeconds。角色、技能、source/题目ID、量规版本等先校验。模型只接收`question-delivery-v1`投影：上一轮回答、原题/技能/难度/类型、规划动作/剩余时间、目标技能掌握度/置信度；不发送身份、凭证、评分反馈、量规/答案锚点或完整历史。它不能更改状态或评分规则。

每次使用独立无工具Pi会话、空资源、内存session，关闭SDK会话retry/compaction；复用当前run已绑定的modelRuntime与HTTP预算。评分、知识工具规划和呈现均逐HTTP记账，不新增绕开预算的请求入口。

## 输出与绑定

模型只返回`{bridge, excerpt}`。桥句最多120个UTF-16单位，摘录最多80；摘录须在当前原回答中逐字唯一出现并包含在桥句内。明显问句、多行、Markdown、指导/评分等表面内容会拒绝；这些规则是保守的字面检查，不能证明桥句没有暗示、事实错误或语义偏移。

宿主返回`uncommitted-question-delivery`，包含原question、run/attempt/session/stateVersion、原answerId、量规/source版本、状态/原因、bridge/excerpt以及最终text。生成成功的text严格等于`bridge + 换行 + 原题全文`，`semanticReview=pending`；回退的bridge/excerpt为null，text严格为原题，不能把回退标成AI生成成功。原题保真只针对技术问题正文，不等于承接语整体语义等价已经审核。

turn结果新增可选`delivery`，`run.stage`可出现`presenting`；`question.completed`仍包含原question，并可携delivery。共享schema关联原题、run/attempt、状态/答案/量规/source；客户端还会与请求核对答案摘录和身份版本。呈现事件会包含学生回答中的短摘录，这是有意的可见内容，不是“事件完全不含回答”；业务API须先校验学生归属并限制转发，不能把服务token当学生身份。

## 时间、失败与费用

未选题/收尾不生成；未注入生成器保持原题。实际run剩余不足单次timeout加2秒余量，或会话不足timeout加pin收尾预留、规划剩余不足45秒时跳过，原因`time-budget`。模型超时默认8秒，宿主可设1毫秒至20秒；取消/期限与每次返回后检查继续有效，正式API仍须在实际发题提交时重查时间/租约和版本。

尚未派发且额度不足时回退`call-budget`；完整用量已结算但JSON/结构/摘录/桥句不合法时回退`invalid-output`。已付费的坏输出仍计费，不自动修复或重试。取消、超时、依赖失败、未知消耗或超用不能转换为成功回退。运行时跟踪真实生成依赖，忽略取消且未结束的Promise继续占槽；这些计数不保证供应商物理资源已释放。

## 验证与当前范围

展示确认的共享契约、API纯helper及离线CAS演练已实现，见[确认与恢复](question-ack.md)。client-reported仅代表客户端上报；正式确认HTTP、数据库和Electron渲染回调仍待接通。

2026-11-04真实千问双岗小样本完成评分→知识工具→选题→承接语，实际8HTTP、7007token、0.103236元声明费率估算，无unknown预留，账单未核对。Java生成“你提到事件带唯一标识保证幂等，现在我们换个方向继续。”，Web生成“你提到新输入时取消旧请求，我们接着聊聊闭包。”；原题分别为volatile和闭包题，逐字保留。样本是手写合成回答和草案知识，人工评分与承接语语义审核仍pending，不代表真实学生体验或教学改善。

离线覆盖SDK隔离、输入投影、原题/量规保真、绑定篡改、真实HTTP响应/SSE订阅与客户端校验、取消/迟到/pending计数、预算skip、坏输出结算回退及unknown不伪装成功。完整workflow已接入可选呈现：首题无前答，保持原题；后续plan可生成承接语。新发题在issuedQuestions[].content中保留原题、量规、来源、最终text及绑定，回答/报告复制presentedText，评分仍仅用原题与量规。JSON文件写盘/恢复和API内存CAS演练已验证，正式数据库写入、客户端展示确认、TTS及澄清/弃评分支呈现仍未实现。2026-11-04新增双岗各两题真实完整会话14HTTP/12935token/0.188436元声明估算通过；回答为手写合成样本，人工语义审核pending。
