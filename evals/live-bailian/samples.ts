import java from '../../knowledge/java-backend/seed.json' with { type:'json' };
import web from '../../knowledge/web-frontend/seed.json' with { type:'json' };
import { createInterviewState } from '../../apps/agent/src/planning/interview-state.ts';
import { selectNextQuestion } from '../../apps/agent/src/planning/select-question.ts';
import { AgentRunRequestSchema } from '../../packages/contracts/src/agent-run.ts';
import type { RoleId } from '../../packages/contracts/src/tools.ts';

/** Fixed, hand-authored synthetic inputs; no student data or human reference score. */
export function acceptanceSample(roleId:RoleId,now:number,deadlineAt:number) {
 const knowledge=roleId==='java-backend'?java:web;
 const state=createInterviewState({sessionId:`smoke-${roleId}`,roleId,durationMinutes:20,
  skills:knowledge.slice(0,2).map((k,i)=>({skillId:k.skillId,relevance:i===0?1:0.9}))},now);
 const first=selectNextQuestion({state,now,knowledge:[knowledge[0]!],askedQuestionIds:[]},{allowDraftKnowledge:true});
 if(first.status!=='selected')throw Error('ACCEPTANCE_SAMPLE_INVALID');
 const context={userId:'synthetic-smoke-user',runId:`smoke-${roleId}`,attemptId:'attempt-1',roleId,deadlineAt};
 const answer=roleId==='java-backend'
  ?'数据库事务不能原子提交缓存。我会在事务内保存订单和待发送事件，提交后重试更新缓存。事件带唯一标识保证幂等，监控积压并允许最终一致；还要考虑重复和乱序。'
  :'我给请求递增序号，只让最新请求更新结果和加载状态。新输入时取消旧请求，但仍检查序号，避免取消来不及。组件卸载后忽略回调，并分别展示加载、空结果和错误状态。';
 return AgentRunRequestSchema.parse({inputSnapshotId:`smoke-input-${roleId}`,context,job:{type:'turn',allowDraftKnowledge:true,
  askedQuestionIds:[first.question.id],knowledge,input:{state,expectedVersion:state.version,observationId:`smoke-observation-${roleId}`,
   goal:'小样本工程验收，不验证评分质量',context,question:first.question,answer:{id:`smoke-answer-${roleId}`,text:answer},
   quality:1,rubric:first.rubric,knowledge:[],planningPolicy:{id:'smoke-policy-v1',roleId,
    parameters:{maxFollowupDepth:0,maxTurns:12,wrapUpSeconds:30}}}}});
}
