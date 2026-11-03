import{createInterviewWorkflow,planInterviewQuestion,submitInterviewAnswer,finishInterviewWorkflow}from'../../apps/agent/src/orchestration/session-workflow.ts';
import{selectNextQuestion}from'../../apps/agent/src/planning/select-question.ts';
import{createEvaluationFixture}from'../pi-sdk/evaluation-fixture.ts';
import{createPiEvaluator}from'../../apps/agent/src/adapters/pi/evaluator.ts';
import type{PlannerInput,PlannerResult}from'../../packages/contracts/src/knowledge-planner.ts';
import type{KnowledgeItem,RoleId}from'../../packages/contracts/src/tools.ts';
/** Synthetic source catalog/receipts, real workflow and Pi local scoring. Does not expand production seeds. */
export async function createWorkflowRsiSource(roleId:RoleId='java-backend'){
 const now=Date.now(),identity={userId:'rsi-fixture',roleId};
 const policy={id:`rsi-baseline-${roleId}`,roleId,parameters:{maxFollowupDepth:2,maxTurns:3,wrapUpSeconds:30}};
 let workflow=createInterviewWorkflow({identity,session:{sessionId:`rsi-source-${roleId}`,roleId,durationMinutes:20,
  skills:[{skillId:'primary',relevance:1},{skillId:'secondary',relevance:.1},{skillId:'third',relevance:.1}]},policy,
  goal:'合成RSI来源场次',skillLabels:{primary:'主要技能',secondary:'第二技能',third:'第三技能'},allowDraftKnowledge:true,now});
 const catalog:KnowledgeItem[]=Array.from({length:3},(_,i)=>({id:`synthetic-${roleId}-q${i}`,roleId,skillId:'primary',questionType:'technical',difficulty:1,
  question:roleId==='java-backend'?`合成事务边界诊断${i}`:`合成异步状态诊断${i}`,keyPoints:['说明条件与失败'],
  rubric:[{criterionId:'correctness',description:'合成手工量规',maxScore:4,weight:1}],sourceIds:['team-original'],version:'synthetic-1',reviewStatus:'draft'}));
 const plan=async(input:PlannerInput):Promise<PlannerResult>=>{
  const selection=selectNextQuestion({state:input.state,now:Date.now(),knowledge:catalog,askedQuestionIds:input.askedQuestionIds,planningPolicy:input.planningPolicy},{allowDraftKnowledge:true});
  const items=catalog.filter(i=>!input.askedQuestionIds.includes(i.id));
  return{kind:'uncommitted-knowledge-plan',selection,modelMessages:0,receipts:[{callId:crypto.randomUUID(),toolName:'query_role_knowledge',durationMs:0,
   status:items.length?'ok':'empty',sourceIds:items.length?['team-original']:[],data:{items}}]};
 };
 const fixture=await createEvaluationFixture(()=>({text:JSON.stringify({evidence:[{id:'e',start:0,end:4,excerpt:'边界条件'}],
  criterionScores:[{criterionId:'correctness',score:1,evidenceIds:['e']}],feedback:{strengths:['合成固定评分'],improvements:['补充其他技能诊断']}})}));
 const evaluate=createPiEvaluator({cwd:process.cwd(),modelRuntime:fixture.runtime,model:fixture.model,roleId});
 for(let i=0;i<3;i++){
  const context={...identity,runId:`rsi-plan-${i}`,attemptId:'a',deadlineAt:Date.now()+60000};
  workflow=await planInterviewQuestion(workflow,{identity,expectedRevision:workflow.revision,context},{plan});
  workflow=await submitInterviewAnswer(workflow,{identity,expectedRevision:workflow.revision,context:{...context,runId:`rsi-answer-${i}`},observationId:`rsi-o${i}`,
   answer:{id:`rsi-a${i}`,text:'边界条件还需验证。'},quality:1,evidenceMode:'offline-fixture'},{evaluate});
 }
 workflow=await finishInterviewWorkflow(workflow,{identity,expectedRevision:workflow.revision,sourceGroupId:`development-workflow-${roleId}`});
 return{workflow,stats:fixture.stats,sourceCatalogMode:'hand-authored-synthetic' as const};
}
