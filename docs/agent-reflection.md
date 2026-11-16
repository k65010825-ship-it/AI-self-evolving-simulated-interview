# 面试反思与离线策略评测

当前是可运行的工程离线模块，不是正式RSI发布链。入口为reflection/reflect-session.ts、evaluate-policy.ts、experiment-registry.ts；共享契约为contracts/policy.ts、reflection.ts、experiment.ts。机器定义随openapi:generate写入evaluation-schemas.json。

## 固定策略

PlanningPolicyVersion={id,roleId,parameters}。参数仅maxFollowupDepth、wrapUpSeconds、maxTurns，默认2/30/12。TurnInput可由宿主传planningPolicy，evaluateTurn实际按其生成nextAction；旧调用默认行为不变。模型不能改该字段。报告policyVersion必须匹配所pin策略ID，未pin的旧记录仍能生成报告，但不参与本轮策略归因。

## reflectSession输入与输出

输入{reportInput,baselinePolicy,generatedAt,sourceGroupId}，均来自可信宿主。先重校验报告/原规划，要求各轮策略与基线完全一致、生成时间不倒退。输出kind=uncommitted-session-reflection，保留sessionId、roleId、sourceGroupId、evidenceMode、baselinePolicy、metrics、findings、calibration和candidate。

| 指标 | 口径 |
| --- | --- |
| skillCoverage | 本场考察的正相关技能数/配置正相关技能数 |
| repeatRate | 本场重复题次数/本场回答数；历史已答也视为重复 |
| planAdherence | 相邻轮实际技能与难度均匹配前一规划的次数/可对照相邻轮数 |
| longestSkillRun | 本场同技能连续回答最大次数 |

比率保留numerator/denominator/value，零分母value=null，findings带观测ID。planAdherence不是独立标注的追问命中率；选题允许最近难度，因此偏离也可能来自题库不足，不自动判定执行故障，但当前不能据此归因策略。

仅至少3轮、覆盖<0.75、实际后续问题都遵循规划、最长同技能连续轮数≥depth+1且depth>1时，候选把maxFollowupDepth下调1，下限1；其他参数/评分权重/权限不变。候选保留前后值和coverage_gap_after_long_skill_run原因，否则candidate=null。阈值是启发式，不代表已验证最优。calibration保持awaiting_eligible_retest、mae=null、sampleCount=0；学习后成绩变化不直接当评分校准误差。

## evaluatePolicyCandidate输入与输出

输入{baseline,candidate,suite,developmentGroupIds,developmentSessionIds?}。suite={version,split:validation,evidenceMode:synthetic,roleId,cases}；每例有id/groupId/tag/state/now/expected{action,skillId}。标签只参与比较，不进入规划函数。

先验证岗位、基线ID和单步变化白名单；开发组不能与验证组重叠，源会话及宿主登记的开发会话也不能出现在验证state或priorEvidence。宿主负责完整声明其他来源，函数不能识别未登记的同源变体。

同一快照分别运行两种参数，保存逐例动作与匹配结果。离线资格门槛固定：至少4例/2组，含真实满足条件的收尾与轮次限制案例，严格匹配率改善、零成对退化、零约束违反。合法未达标返回rejected/reasons；输入错配或污染抛契约错误。标签不含难度，因此匹配率只衡量动作/技能，难度执行偏离在反思中另行核对。

输出kind=offline-policy-evaluation、status=eligible_for_offline_experiment/rejected、deploymentStatus始终not_published，含suiteVersion、分子分母/比率、delta、regressions、groups和逐例记录。这个4例工程门槛不替代正式数据量/统计/真人验收或策略发布门槛。正式champion存储、事务启用/回退、在途版本固定和后续表现配对仍待实现。

## 可复现演示与证据边界

运行bun run agent:reflection:demo，分别执行两岗合成轨迹反思及固定4例、3组验证。开发轨迹在experiments/reflection/session-fixture.ts，验证标签在evals/policy/validation-scenarios.ts，二者来源组分离。演示基线2/4、候选4/4，说明手写边界场景上的规则匹配改变，不是学生成长、真人追问命中或教学因果效果。没有真实模型调用，没有发布正式策略。

基线ID错配VERSION_CONFLICT，岗位错配ROLE_FORBIDDEN；未pin、篡改规划、非法候选或开发/验证重叠VALIDATION_ERROR。失败不修改基线/输入、不自动重试、不为了过门槛调整标签或发布规则。

## 离线实验状态机与会话固定

scope固定offline-experiment，kind=uncommitted-experiment-registry；实验active变化不等于正式发布。独立岗位/experimentId，不提供管理员认证，调用方须为已授权宿主代码，不是模型工具。

| 函数 | 参数与行为 |
| --- | --- |
| createExperimentRegistry | {experimentId,roleId,now,baselinePolicy}；初始version0、active=baseline |
| applyExperimentOperation | registry与严格请求，action为evaluate/rollback，公共字段operationId/expectedVersion/now/experimentId/roleId |
| pinSessionPolicy | registry与{experimentId,roleId,sessionId,now}；返回启动时policy副本和registryVersion |
| restoreExperimentRegistry | JSON字符串与{experimentId,roleId}；校验结构、审计因果、算术、时间和归属 |

evaluate请求必须带完整evaluationInput，禁止调用方附成功summary跳过验证；当前active必须与输入基线全量相同，候选创建时间不得晚于操作时间。函数实际重跑evaluatePolicyCandidate，合格才登记不可变策略并改变实验active；合法rejected也记录审计、version加1，active不变。相同策略ID定义不能变化，反思候选采用固定长度摘要ID避免长基线ID超出可pin范围。

rollback请求含targetPolicyId/reason，只允许当前策略的已登记祖先；不能借回退向前切到后代或未知策略。历史策略保留用于审计和重新评测；回退后用新操作重新提交同一合法候选可以再次评测启用，旧操作重放则只返回当前快照，不重新启用。

操作摘要对解析后的业务内容计算SHA-256，包含操作ID/实验身份/动作/完整评测输入或目标/理由；不含now/expectedVersion。相同operationId相同业务内容可安全重放（允许旧版本），变更内容VERSION_CONFLICT；重放时间不能早于该操作processedAt，新操作须不早于整体updatedAt且expectedVersion匹配。输入对象不变，无部分追加。最多50条操作/51个策略及400万UTF-16序列化单位，超限VALIDATION_ERROR，不静默截断审计。

registry恢复会核对连续seq、前后active、角色/策略引用、祖先关系、评测分子分母/逐例匹配算术及当前头部。它不保留原请求和场景状态，不能重新验证原guardrail/来源隔离，也不是签名或防篡改存储。原始请求、源验证集版本与快照必须由后端可信存储，并以数据库事务/CAS提交；不能只凭摘要或JSON通过就宣布真实性。

pin是独立副本，后续active改变或回退都不会修改已经持有的pin；函数不维护sessionId→pin仓库。API必须在开场时一次固定并保存，将pin.policy传入各轮planningPolicy，不能每轮重新取active，重复开场也须复用已保存pin。当前未实现正式会话绑定事务或进程重启恢复。

运行bun run agent:experiment:demo：两岗各执行合法拒绝→合格启用→祖先回退→原启用请求重放→JSON恢复。最终registryVersion3、active回到基线，旧pin深度2、新pin深度1仍各自保留。模型调用0，productionPublished=false，均为合成离线流程，不代表真人效果或生产champion启用。
