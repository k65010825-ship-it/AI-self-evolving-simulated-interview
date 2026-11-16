import type {RoleId} from '../../packages/contracts/src/tools.ts';
import {createInterviewState} from '../../apps/agent/src/planning/interview-state.ts';
import {selectNextQuestion} from '../../apps/agent/src/planning/select-question.ts';
export const observationVariants=['valid','wrong-value','label-read','style-nonnumeric','style-numeric','wrong-condition','cross-sentence'] as const;
export type ObservationVariant=typeof observationVariants[number];
/** Explicit new synthetic goals; annotated spans are injected, not real model extraction evidence. */
export function observationScenario(roleId:RoleId='java-backend',variant:ObservationVariant='valid'){
 const java=roleId==='java-backend',at=Date.now(),metric=java?'成功数':'actualDuration',action=java?'并发申请':'对照测量',target=java?'容量计数器':'列表组件';
 const condition=variant==='wrong-condition'?(java?'初值10':'不同交互'):(java?'初值99':'相同交互');
 const values={valid:java?'最多1':'下降20%','wrong-value':java?'最多100':'升高20%','label-read':java?'1':'10ms','style-nonnumeric':java?'变蓝':'变大','style-numeric':java?'2':'增加20%','wrong-condition':java?'最多1':'下降20%','cross-sentence':java?'2':'10ms'};
 const value=values[variant];
 const observations={valid:metric+value,'wrong-value':metric+value,'label-read':metric+(java?'标签显示':'面板读数')+value,'style-nonnumeric':metric+(java?'标签颜色':'标题字号')+value,
  'style-numeric':metric+(java?'标签字号增加':'标题字体')+value,'wrong-condition':metric+value,'cross-sentence':metric+(java?'。另一个数是':'。其他耗时')+value};
 const expectation='预期'+observations[variant],text=`假设${condition}下${action}${target}，${expectation}。`;
 const ref=(fragment:string,from=0)=>{const start=text.indexOf(fragment,from);if(start<0)throw Error('OBSERVATION_FIXTURE_INVALID');return{evidenceId:'unit',start,end:start+fragment.length};};
 const goal={id:java?'typed-capacity':'typed-render-duration',version:'typed-1',actionAliases:[action],targetAliases:[target],observationAliases:[metric],
  observationPolicy:{kind:java?'count' as const:'duration' as const,conditionAliases:[java?'初值99':'相同交互']}};
 const binding={goalId:goal.id,goalVersion:goal.version,mode:'proposed' as const,action:ref(action),target:ref(target),expectation:ref(expectation),
  observation:{metric:ref(metric,text.indexOf(expectation)),value:ref(value,text.indexOf(expectation)),condition:ref(condition)}};
 const state=createInterviewState({sessionId:'typed-'+roleId,roleId,durationMinutes:20,skills:[{skillId:goal.id,relevance:1}]},at);
 const item={id:goal.id,version:'synthetic-observation-1',roleId,skillId:goal.id,questionType:'scenario',difficulty:2,question:java?'初值99上限100时，说明并发申请容量与验证条件。':'在相同交互条件下，说明列表组件渲染耗时的验证。',
  keyPoints:['明确观测值与条件，不伪造执行'],rubric:[{criterionId:'verification',dimension:'verification',description:'相关的验证动作、观测量及条件',maxScore:4,weight:1,verificationGoal:goal}],sourceIds:['assistant-authored-synthetic-development'],reviewStatus:'draft'};
 const selection=selectNextQuestion({state,now:at,knowledge:[item],askedQuestionIds:[]},{allowDraftKnowledge:true});if(selection.status!=='selected')throw Error('OBSERVATION_FIXTURE_INVALID');
 const input={state,expectedVersion:0,observationId:'observation',goal:'typed synthetic measurement',context:{userId:'synthetic',roleId,runId:'typed-'+roleId,attemptId:'a',deadlineAt:at+60000},question:selection.question,answer:{id:'answer',text},quality:1,knowledge:[],rubric:selection.rubric,planningPolicy:{id:'typed-policy',roleId,parameters:{}}};
 const assessment={evidence:[{id:'unit',start:0,end:text.length,excerpt:text}],criterionScores:[{criterionId:'verification',score:variant==='wrong-value'?0:3,evidenceIds:['unit'],verificationBinding:binding}],feedback:{strengths:[],improvements:['补充验证的充分性和适用边界']}};
 return {at,input,assessment,goal,binding,expectedBound:['valid','wrong-value','label-read'].includes(variant)};
}
