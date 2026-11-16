import {loadKnowledgeWorkspace} from '../../apps/agent/src/knowledge/catalog.ts';
import {compileVerificationProposal,loadVerificationProposal} from '../knowledge-verification/proposal.ts';
import {ScoringQualityCaseSchema,type ScoringQualityCase} from '../../packages/contracts/src/scoring-quality.ts';
import {AgentRunRequestSchema} from '../../packages/contracts/src/agent-run.ts';
import {createInterviewState} from '../../apps/agent/src/planning/interview-state.ts';
import {selectNextQuestion} from '../../apps/agent/src/planning/select-question.ts';
export function loadScoringQualityCases():ScoringQualityCase[]{
 const knowledge=loadKnowledgeWorkspace(),proposal=compileVerificationProposal(loadVerificationProposal('observation'));
 return (['java-backend','web-frontend']as const).flatMap(roleId=>{
  const java=roleId==='java-backend',item=knowledge.items.find(i=>i.id===(java?'java-technical-visibility':'web-scenario-autocomplete'))!,verification=proposal.workspace.items.find(i=>i.roleId===roleId)!;
  const normal=java?'volatile保证对同一变量写入对后续读取的可见性，但count++包含读、加、写，两个线程可能丢失更新，volatile不保证这个复合操作原子。单变量计数可用AtomicInteger.incrementAndGet；多个变量的不变量要把检查和写入放进同一把锁或CAS设计，不能认为换成原子类就自动保护所有复合逻辑。':'每次搜索递增请求序号，响应提交前校验自己仍是最新请求；新请求可AbortController取消旧请求，但仍保留序号检查。组件卸载时清理并取消。只有当前请求能设置结果、错误和loading，旧请求的finally不能提前清除新请求的loading。保留已有结果还是清空由交互要求决定，取消错误单独处理。';
  const verificationAnswer=java?'假设我负责单JVM名额计数器的CAS实现，不讨论多实例。上限检查与compareAndSet更新放在同一循环，CAS失败后重读，满额拒绝；单次申请且不归还或重试，所以计数不超过100。我用失败边界解释方案，未声称完成真实压测。假设初值99且不归还或重试，同步起跑并发申请容量计数器，预期成功数最多1，同时核对最终计数不超过100。':'假设我负责列表组件的状态边界调整，把筛选状态留在相关组件，避免无关更新传入，使用稳定引用时同时检查闭包与缓存代价。先用Profiler定位组件子树，再对比修改，不能直接外推全站体验。假设在相同交互下对照测量列表组件，预期actualDuration下降20%；固定性能构建和设备，重复采样，并独立核对筛选结果。这是验证方案，不声称真实用户效果已经改善。';
  return (['normal','insufficient','abstention','verification']as const).map(category=>{
   const selected=category==='verification'?verification:item,scored=category==='normal'||category==='verification';
   return ScoringQualityCaseSchema.parse({id:roleId+'-'+category,roleId,category,item:selected,
    answer:category==='normal'?normal:category==='verification'?verificationAnswer:category==='abstention'?'不知道。':'我参与过相关项目，也会先分析问题再选择合适的方案，但具体边界、执行操作和结果还没有说明。',
    expectedOutcome:scored?'scored':category==='abstention'?'abstained':'needs_clarification',
    reference:{origin:'assistant-authored-draft',rationale:scored?(category==='normal'?'覆盖题目核心机制与边界；草案预期各维度至少达到归一化0.75，未经独立人工校准。':'提供明确假设贡献、正确性边界和同一局部语句中的条件/动作/对象/预期；草案区间0.5到1，绑定不代表实际执行或语义正确。'):'没有足够的岗位知识断言；应保持未知而非编造引文或将缺分转换成0。明确不会且澄清额度为0时终止弃评。',
     bands:scored?selected.rubric.map(c=>({criterionId:c.criterionId,min:category==='normal'?.75:.5,max:1})):[]}});
  });
 });
}
/** New AI development controls; distinct inputs are not independent human or statistically held-out labels. */
export function loadScoringContrastCases():ScoringQualityCase[]{
 const baseline=loadScoringQualityCases();return baseline.map(base=>{
  const java=base.roleId==='java-backend',category=base.category==='verification'?'incorrect':base.category;
  const item=baseline.find(c=>c.roleId===base.roleId&&c.category==='normal')!.item;
  const answer=category==='normal'?(java?'对同一volatile变量的写入与后续读取有可见性保证，但先读再加再写不是单一原子操作。我会用同一把锁覆盖计数器的整个读改写；若改用AtomicInteger，也只依赖相应原子方法，不假设get与set组合会自动变原子。':'我为每次搜索分配递增的代数，只有与当前代数一致的请求才能提交结果、错误及结束加载。卸载时取消请求并撤销提交资格；取消不能替代提交前校验，防止已经完成或不可取消的旧响应覆盖当前状态。'):
   category==='insufficient'?(java?'这类并发问题我以前接触过，准备从需求开始逐步梳理，具体机制和代码判断暂时没有展开。':'相关交互需求我已经了解，会先讨论设计再安排实现，怎样处理不同请求的状态还没有给出说明。'):
   category==='abstention'?'暂时不会。':java?'volatile 会让 count++ 整个复合操作成为原子步骤，所以多个线程同时加一也绝不会丢失更新，不需要锁或原子类。':'我让每个搜索响应一回来就直接覆盖结果，旧请求晚返回覆盖新结果也没关系；所有请求的 finally 都清空 loading，不需要请求序号或取消处理。';
  return ScoringQualityCaseSchema.parse({...base,id:base.roleId+'-contrast-'+category,category,item,answer,expectedOutcome:category==='normal'||category==='incorrect'?'scored':base.expectedOutcome,
   reference:category==='incorrect'?{origin:'assistant-authored-draft',rationale:'明确给出与题目核心保证相反的可评分断言；草案期望有原文证据的0分，不能当作未知弃评。',bands:item.rubric.map(c=>({criterionId:c.criterionId,min:0,max:0}))}:base.reference});
 });
}
/** Only host question/rubric and the answer enter inference, never reference bands or category labels. */
export function scoringQualityRequest(sample:ScoringQualityCase,startedAt:number,deadlineAt:number,runId:string){
 const state=createInterviewState({sessionId:'quality-session-'+runId,roleId:sample.roleId,durationMinutes:25,skills:[{skillId:sample.item.skillId,relevance:1}]},startedAt);
 const selected=selectNextQuestion({state,now:startedAt,knowledge:[sample.item],askedQuestionIds:[]},{allowDraftKnowledge:true});if(selected.status!=='selected')throw Error('SCORING_QUALITY_SAMPLE_INVALID');
 const context={userId:'synthetic-scoring-quality',roleId:sample.roleId,runId,attemptId:'attempt-1',deadlineAt};
 return AgentRunRequestSchema.parse({inputSnapshotId:'input-'+runId,context,job:{type:'turn',knowledge:[],askedQuestionIds:[sample.item.id],allowDraftKnowledge:true,
  clarification:sample.category==='abstention'?{policy:{maxClarifications:0,minRemainingSeconds:45}}:{},
  input:{state,expectedVersion:0,observationId:'observation-'+runId,goal:'评估当前回答内容',context,question:selected.question,rubric:selected.rubric,answer:{id:'answer-'+runId,text:sample.answer},quality:1,knowledge:[]}}});
}
