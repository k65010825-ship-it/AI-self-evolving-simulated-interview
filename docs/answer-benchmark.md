# 回答草案参考集与离线评分误差

本模块为后续模型评分提供可审核的对照材料和运行器。当前18条回答与参考均为assistant-authored合成草案，人工独立标注为0；没有真实模型准确率、评分改善或教学收益结论。所谓“独立”指参考文件与推理输入分离、题族分组隔离，不意味着独立人工作者或专家金标准。

## 数据与分组

| 文件 | 内容 |
| --- | --- |
| evals/answers/manifest.json | 数据ID/版本、作者来源、六个题目的知识内容/来源摘要pins |
| evals/answers/cases.json | 每岗三个题族，各含较完整、明显误解、信息不足回答，共18例 |
| evals/answers/references.json | 单独存放草案分维分数、回答原文引用、解释、case/rubric摘要；全部synthetic-proposed/draft |

development、validation、reserved-final各6例（每岗3例），按题族分割。同group跨split、同questionId换group、规范化后相同回答跨split均拒绝。规范化做NFKC、空白移除及小写，用于近似重复检查，不做语义相似判断；变体家族仍依赖维护者正确声明。

题目和量规来自当前知识包，但回答与标签另行编写。pins绑定题目+dossier及完整来源元数据；题目、指南或来源变化会报ANSWER_DATASET_STALE。每条参考另绑定caseDigest和rubricDigest；回答变更或引用片段不匹配拒绝。数据digest还覆盖参考标签本身，所以修改标签后旧报告不可按新集校验。修改材料应同时更新版本，不能重算摘要来伪装原审核结果。

这些合成样例没有增加evals/datasets/manifest.json中的真人/人工参考observedCount，其值仍为0。每岗9例草案远未达到原计划每岗60条人工核对回答的目标。

## 运行与审核包

```powershell
bun run agent:answers:eval
bun run agent:answers:eval --split validation
bun run agent:answers:eval --review
bun run agent:answers:eval --verify ".cache/answer-benchmark/run-实际目录/report.json"
```

默认只跑development，validation须显式选择；reserved-final在CLI和底层运行器均拒绝执行。最终草案存于仓库且包含在审核包中，只是预留分组，不能称为盲藏最终集，更不用于自动挑策略或调门槛。

每次在.cache/answer-benchmark创建新目录：运行产物report.json/report.md不包含回答正文、证据原文、反馈或上游异常；审核包packet.json则刻意包含原创合成回答、参考和量规，供实际审核者逐锚点提出修订。审核包命令不生成批准；当前契约只接收synthetic-proposed/draft。真实人工参考与同意使用的真人材料导入，需要明确来源、独立审核身份、契约和授权边界后另行实现。

CLI退出0只表示该次离线评估均产出合法投影，不表示误差达标；存在失败/取消/超时案例则退出1并保留报告。高MAE和过度给分会如实保留，没有为了“通过”而设置模型质量阈值。

## 模型输入边界与运行器

runAnswerBenchmark编译并复制数据，按选定split运行。给evaluate回调的只有当前回答、岗位/技能状态、问题和基准量规；不传caseId、variant、split、groupId、参考分数、参考解释或答题指南。模型可见题目/量规ID，但不能靠样例类别直接读出标签。此为代码数据流隔离，不是不同安全进程的物理隔离。

实际CLI调用真实Pi SDK，本地provider仅根据请求中的各维maxScore固定给一半，引用当前回答全文，不读取参考文件或按variant分支；网络模型调用为0。它会给信息不足回答分数，用来演示缺分分歧和误差，不是一个有语义能力的评分模型。

本基准把所有维度required设为false以测弃分行为，数值范围、权重、锚点与岗位口径仍绑定原题。它直接测评估器，不经过正式evaluateTurn提交：正式turn必评维缺失仍按原规则拒绝，不因基准允许null而放宽。

输出先过EvaluationOutputSchema，再校验UTF-16引用与原文一致、维度齐全/唯一、分数范围及证据ID。数值分必须有引用，null不得携带用于打分的引用；重复证据ID拒绝。字面匹配不证明引用在语义上支持给分，固定半分替身会体现这个局限。

每例独立Pi会话、无工具；外层有截止和取消，忽略信号的依赖不能迟到写入成功投影。截止也在同步依赖返回与输出验证后用单调时间检查，避免定时器回调被CPU阻塞而误接受；不能强行抢占同步CPU或保证远端计算停止。预取消不发评估请求，其他失败保留静态错误码、继续记下全部所选案例。

## 指标口径

按岗位分别输出，不用两岗混合均分制造效果。

| 字段 | 定义 |
| --- | --- |
| totalCount / completedCount / failureCount | 所选案例总数、合法输出投影数、失败/取消/超时数；失败不会被移出总分母 |
| fullyScoredCount | 预测每维均非null的回答数，绝非获得满分的回答数 |
| criterionError | 每维除以各自maxScore；仅双方非null时累加绝对误差/有符号误差，除以pairedCount得到MAE/偏差 |
| dimensions | 按量规dimension分组的同一误差口径，仍显示配对数 |
| weightedError | 仅双方全部维度非null时计算原权重总分误差；不对剩余维度重新归一化 |
| nullAgreement.overScored | 草案参考为null、预测却有数值的维度数；并非一般意义的“预测分高于参考” |
| nullAgreement.underScored / bothMissing | 参考有分而预测null、双方都null；失败行不伪装成弃分 |
| humanReferenceMae | 始终null，humanReferenceCount=0，qualityClaimEligible=false |

pairedCount=0时MAE和偏差为null，不填0。全弃分可能没有任何数值误差配对，必须同时看underScored与覆盖；全失败同样不能展示“零误差”。偏差=预测减参考，正负可抵消，不能只看偏差不看MAE。

当前固定半分演示在两岗development与validation均得到：每岗4个维度配对、MAE0.5、偏差0；完整回答配对2例、加权MAE0.5；每岗2个“参考缺分但预测给分”维度。只是草案算术对照，无统计充分性或模型质量结论。

## 报告校验与协作

共享契约见packages/contracts/src/answer-benchmark.ts和[生成Schema](answer-benchmark-schemas.json)。--verify最多读2MiB JSON，检查数据digest、严格结构、案例完整性/归属/量规、数值范围，重新计算指标并核对报告摘要；不重跑推理，不重做证据语义审核。

报告中的assessmentDigest只是当时完整评估输出的摘要；原始正文不在报告中，因此投影校验不能重新验证原引用。所有SHA都是变更检测，不认证来源或执行。当前报告不提供代码签名、安装依赖证明或供应商调用记录，evaluatorId是宿主声明的标识。

后续先由实际岗位审核者独立检查锚点、片段、null与分数，分歧留痕；再接入已授权模型固定版本与预算，保持分组隔离。不要拿这18条草案反复改标签使模型“通过”，不要从评分对照直接调整正式学生成绩或发布RSI策略。
