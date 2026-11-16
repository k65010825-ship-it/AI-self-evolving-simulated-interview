import {ScoringQualityCaseSchema,type ScoringQualityCase} from '../../packages/contracts/src/scoring-quality.ts';
import {loadScoringQualityCases} from './dataset.ts';
/** New development hypotheses, never human labels or retrospective edits to baseline. */
export function loadScoringChallengeCases():ScoringQualityCase[]{
 const baseline=loadScoringQualityCases();
 return (['java-backend','web-frontend']as const).flatMap(roleId=>{
  const java=roleId==='java-backend',ordinary=baseline.find(c=>c.roleId===roleId&&c.category==='normal')!,verified=baseline.find(c=>c.roleId===roleId&&c.category==='verification')!;
  const base=ordinary.item,goal=verified.item.rubric.find(c=>c.verificationGoal)!;
  const partial={...base,id:base.id+'-eval-1',version:'challenge-draft-1',reviewStatus:'draft',rubric:[{...base.rubric[0]!,description:java?'区分volatile可见性与count++原子性；只解释其中一项可得部分分，明确未知部分不编造。':'最新请求的结果、错误与loading所有权，以及取消和卸载；仅说明结果序号守卫可得部分分。',anchors:[{score:0,description:'有相关但明确相反的错误断言；缺失证据不能补0'},{score:2,description:'给出一个正确核心机制，其他边界明确尚未说明'},{score:4,description:'正确说明全部核心机制与边界并解释理由'}]}]};
  const mixed={...base,id:base.id+'-eval-2',version:'challenge-draft-1',reviewStatus:'draft',rubric:[
   {criterionId:java?'visibility':'result-ownership',maxScore:4,weight:.5,description:java?'volatile写对后续读的可见性判断；与复合原子性分开评。':'最新请求才能提交结果的所有权；与loading所有权分开评。'},
   {criterionId:java?'atomicity':'loading-ownership',maxScore:4,weight:.5,description:java?'count++包含读改写，volatile本身不保证整个复合操作原子；相反断言应有证据0分。':'只有当前请求能结束其loading，旧请求finally不能清除新请求loading；相反断言应有证据0分。'},
  ]};
  const wrong={...verified.item,id:verified.item.id+'-eval-3',version:'challenge-draft-1',reviewStatus:'draft',
   question:java?'单JVM容量上限100、初值99，单轮不归还也不重试。请给出并发申请的成功数预期，并解释结果。':'相同交互下，列表组件actualDuration从100ms变为80ms。请说明对照测量与耗时变化比例，不要把子树耗时等同全站收益。',
   rubric:[{...goal,weight:1,description:java?'核对单轮初值99/上限100的成功数结论，最多1而不是100；相关错误数值保留为可评分证据。':'核对100ms到80ms为耗时下降20%，不是80%；相关但明确算错的结论可0分，缺少证据不补0。',
    anchors:[{score:0,description:'明确给出与题目约束或变化率计算相反的结论，并有完整可定位验证证据'},{score:2,description:'验证与核心结论正确，但条件或测量边界说明有限'},{score:4,description:'验证可复现、结论正确并交代证明与测量的局限'}]}]};
  const entries=[
   {category:'partial',item:partial,answer:java?'我知道volatile写入对后续读取可见；至于count++能否原子执行、应如何保护，我还没想清楚。':'每次新搜索递增请求序号，旧响应在提交结果前发现不是最新序号就丢弃；loading结束和卸载清理的细节我还没想清楚。',bands:[{criterionId:base.rubric[0]!.criterionId,min:.25,max:.75}],rationale:'存在明确正确机制且承认未覆盖边界，应部分正分而非整答弃评或满分；AI草案区间，非专家标签。'},
   {category:'mixed',item:mixed,answer:java?'volatile写入对后续读取有可见性保证。同时我认为count++整体也因此是原子的，多线程加一绝不会丢失更新，不用锁或原子类。':'我为搜索请求分配递增序号，仅允许最新响应提交结果。同时任何旧请求的finally都应把loading清空，即使更新的请求还在等待也一样。',bands:[{criterionId:mixed.rubric[0]!.criterionId,min:.5,max:1},{criterionId:mixed.rubric[1]!.criterionId,min:0,max:0}],rationale:'同一回答含一项正确机制与另一项明确错误；应逐维保留正分和有证据0分，不整体洗白或弃评。'},
   {category:'verification',item:wrong,answer:java?'假设初值99，单JVM上限100，且不归还或重试，同步起跑并发申请容量计数器，预期成功数最多100；我认为这就说明容量仍正确。':'假设在相同交互下对照测量列表组件，已知前100ms后80ms，我预期actualDuration下降80%，因为我把剩余的80ms直接当成下降80%；这只是我的验证方案。',bands:[{criterionId:goal.criterionId,min:0,max:0}],rationale:'条件、动作、对象与错误预期均可引用；错结论须有证据0分，不能因为数值错误转为缺证据，也不能当正确。'},
   {category:'abstention',item:base,answer:'暂时不会。',bands:[],rationale:'使用宿主已支持的明确不会短句且澄清额度0，零调用弃评控制；不冒充难例语义评分。'},
  ];
  return entries.map(e=>ScoringQualityCaseSchema.parse({id:roleId+'-challenge-'+e.category,roleId,category:e.category,item:e.item,answer:e.answer,expectedOutcome:e.category==='abstention'?'abstained':'scored',reference:{origin:'assistant-authored-draft',rationale:e.rationale,bands:e.bands}}));
 });
}
