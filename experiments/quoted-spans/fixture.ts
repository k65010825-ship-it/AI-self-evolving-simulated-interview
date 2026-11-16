import {TurnInputSchema} from '../../packages/contracts/src/evaluation.ts';
import {createInterviewState} from '../../apps/agent/src/planning/interview-state.ts';
import type {RoleId} from '../../packages/contracts/src/tools.ts';
/** AI-authored mechanism fixture; not a participant answer or scoring gold standard. */
export function quotedFixture(role:RoleId='java-backend',score=3){
 const java=role==='java-backend',condition=java?'初值99':'相同交互',action=java?'并发申请':'对照测量',target=java?'容量计数器':'列表组件';
 const metric=java?'成功数':'actualDuration',value=java?(score===0?'最多100':'最多1'):'下降20%';
 const text=`😀假设${condition}，${action}${target}，预期${metric}${value}。`;
 const goal={id:'quoted-'+role,version:'1',actionAliases:[action],targetAliases:[target],observationAliases:[metric],observationPolicy:{kind:java?'count' as const:'duration' as const,conditionAliases:[condition]}};
 const quote=(excerpt:string)=>({evidenceId:'unit',excerpt});
 const wire={evidence:[{id:'unit',excerpt:text}],criterionScores:[{criterionId:'verification',score,evidenceIds:['unit'],verificationBinding:{goalId:goal.id,goalVersion:goal.version,mode:'proposed',
  action:quote(action),target:quote(target),expectation:quote('预期'+metric+value),observation:{metric:quote(metric),value:quote(value),condition:quote(condition)}}}],feedback:{strengths:[],improvements:['仅验证结构，不是质量金标准']}};
 const now=Date.now(),state=createInterviewState({sessionId:'quoted-session-'+role,roleId:role,durationMinutes:20,skills:[{skillId:'validation',relevance:1}]},now);
 const context={userId:'synthetic-quoted-fixture',roleId:role,runId:'quoted-'+role,attemptId:'one',deadlineAt:now+60000};
 const input=TurnInputSchema.parse({state,expectedVersion:0,observationId:'quoted-observation',goal:'合成验证引用机制',context,
  question:{id:'quoted-question',roleId:role,skillId:'validation',text:'解释验证方案',questionType:'technical',difficulty:1},answer:{id:'quoted-answer',text},quality:1,knowledge:[],
  rubric:{id:'quoted-rubric',version:'1',roleId:role,scope:'technical-content',criteria:[{id:'verification',dimension:'verification',maxScore:4,weight:1,required:true,verificationGoal:goal}]}});
 return {text,wire,input};
}
