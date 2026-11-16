import {createInterviewState} from '../../apps/agent/src/planning/interview-state.ts';
import {selectNextQuestion} from '../../apps/agent/src/planning/select-question.ts';
import type {RoleId} from '../../packages/contracts/src/tools.ts';
/** New synthetic rubric versions; never modify the installed draft knowledge or field answers. */
export function verificationScenario(roleId:RoleId='java-backend'){
 const java=roleId==='java-backend',at=Date.now(),skillId=java?'synthetic-idempotency':'synthetic-response-race';
 const text=java?'假设并发重放同一幂等键，预期订单数=1。':'假设让同一搜索框的请求逆序返回，预期最终展示最新输入对应的结果。';
 const action=java?'并发重放':'逆序返回',target=java?'同一幂等键':'同一搜索框',expectation=java?'预期订单数=1':'预期最终展示最新输入对应的结果';
 const goal={id:skillId,version:'1',actionAliases:[action],targetAliases:[target],observationAliases:[java?'订单数':'最新输入']};
 const item={id:skillId,version:'synthetic-binding-1',roleId,skillId,questionType:'scenario',difficulty:2,question:java?'说明重复提交的验证方案。':'说明搜索响应竞态的验证方案。',
  keyPoints:['提供目标、操作与可观察结果'],rubric:[{criterionId:'verification',dimension:'verification',verificationGoal:goal,description:'对指定目标给出验证过程',maxScore:4,weight:1}],sourceIds:['assistant-authored-synthetic-development'],reviewStatus:'draft'};
 const state=createInterviewState({sessionId:'synthetic-'+roleId,roleId,durationMinutes:20,skills:[{skillId,relevance:1}]},at);
 const selection=selectNextQuestion({state,now:at,knowledge:[item],askedQuestionIds:[]},{allowDraftKnowledge:true});
 if(selection.status!=='selected')throw Error('VERIFICATION_FIXTURE_INVALID');
 const ref=(fragment:string)=>({evidenceId:'unit',start:text.indexOf(fragment),end:text.indexOf(fragment)+fragment.length});
 const binding={goalId:goal.id,goalVersion:goal.version,mode:'proposed' as const,action:ref(action),target:ref(target),expectation:ref(expectation)};
 const input={state,expectedVersion:0,observationId:'observation',goal:'synthetic binding exercise',context:{userId:'synthetic',roleId,runId:'synthetic-'+roleId,attemptId:'a',deadlineAt:at+60000},
  question:selection.question,answer:{id:'answer',text},quality:1,knowledge:[],rubric:selection.rubric,planningPolicy:{id:'synthetic-policy',roleId,parameters:{}}};
 const assessment={evidence:[{id:'unit',start:0,end:text.length,excerpt:text}],criterionScores:[{criterionId:'verification',score:3,evidenceIds:['unit'],verificationBinding:binding}],feedback:{strengths:['提供了明确验证过程'],improvements:['扩大边界用例覆盖']}};
 return {at,input,assessment,selection};
}
