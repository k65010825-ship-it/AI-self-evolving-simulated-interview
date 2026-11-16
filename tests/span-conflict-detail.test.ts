import {expect,test} from 'bun:test';
import {inspectVerificationBinding} from '../packages/interview-domain/src/verification-binding.ts';
const answer='初值99且无归还，并发申请容量计数器，预期成功数最多1。';
const ref=(s:string)=>({evidenceId:'private-unit',start:answer.indexOf(s),end:answer.indexOf(s)+s.length});
const goal={id:'private-goal',version:'1',actionAliases:['并发申请'],targetAliases:['容量计数器'],observationAliases:['成功数']};
const binding={goalId:goal.id,goalVersion:'1',mode:'proposed' as const,action:ref('并发申请'),target:ref('容量计数器'),expectation:ref('预期成功数最多1')};
const evidence=[{id:'private-unit',start:0,end:answer.length,excerpt:answer}];
test('procedure overlap reports the existing first failing field pair and relation',()=>{
 expect(inspectVerificationBinding(goal,{...binding,target:binding.action},evidence,['private-unit'],answer)).toMatchObject({detail:'span-overlap',conflict:{parts:['action','target'],relation:'identical'}});
 const whole={...binding.action,end:binding.target.end};
 expect(inspectVerificationBinding(goal,{...binding,action:whole},evidence,['private-unit'],answer)).toMatchObject({conflict:{parts:['action','target'],relation:'contains'}});
 const result=inspectVerificationBinding(goal,{...binding,expectation:{...binding.action,end:binding.expectation.end}},evidence,['private-unit'],answer);
 expect(result).toMatchObject({conflict:{parts:['action','expectation'],relation:'contained-by'}});expect(JSON.stringify(result)).not.toContain('private');
 expect(inspectVerificationBinding(goal,{...binding,action:{...binding.action,end:binding.target.start+1}},evidence,['private-unit'],answer)).toMatchObject({conflict:{parts:['action','target'],relation:'partial-overlap'}});
});
test('adjacent procedure spans and legal nested observation parts remain valid',()=>{
 const g={...goal,observationPolicy:{kind:'count' as const,conditionAliases:['初值99']}};
 const b={...binding,observation:{metric:ref('成功数'),value:ref('最多1'),condition:ref('初值99')}};
 expect(inspectVerificationBinding(g,b,evidence,['private-unit'],answer)).toEqual({status:'bound',semanticSupport:'not_verified'});
 expect(inspectVerificationBinding(g,{...b,observation:{...b.observation,value:b.observation.metric}},evidence,['private-unit'],answer)).toMatchObject({detail:'observation-span-overlap',conflict:{parts:['metric','value'],relation:'identical'}});
});
test('named predicate may contain metric; diagnostics must not broaden the existing overlap rejection',()=>{
 const text='初值99，并发申请容量计数器，预期没有超额。',r=(s:string)=>({evidenceId:'e',start:text.indexOf(s),end:text.indexOf(s)+s.length});
 const g={...goal,observationAliases:['超额'],observationPolicy:{kind:'count' as const,conditionAliases:['初值99'],predicateAliases:['没有超额']}};
 const b={...binding,action:r('并发申请'),target:r('容量计数器'),expectation:r('预期没有超额'),observation:{metric:r('超额'),value:r('没有超额'),condition:r('初值99')}};
 expect(inspectVerificationBinding(g,b,[{id:'e',start:0,end:text.length,excerpt:text}],['e'],text)).toEqual({status:'bound',semanticSupport:'not_verified'});
});
test('condition may reuse action text while procedure fields stay disjoint',()=>{
 const text='在相同交互下对照测量列表组件，预期actualDuration下降20%。',r=(s:string)=>({evidenceId:'e',start:text.indexOf(s),end:text.indexOf(s)+s.length});
 const g={id:'web',version:'1',actionAliases:['对照测量'],targetAliases:['列表组件'],observationAliases:['actualDuration'],observationPolicy:{kind:'duration' as const,conditionAliases:['相同交互']}};
 const b={goalId:'web',goalVersion:'1',mode:'proposed' as const,action:r('在相同交互下对照测量'),target:r('列表组件'),expectation:r('预期actualDuration下降20%'),observation:{metric:r('actualDuration'),value:r('下降20%'),condition:r('相同交互')}};
 expect(inspectVerificationBinding(g,b,[{id:'e',start:0,end:text.length,excerpt:text}],['e'],text)).toEqual({status:'bound',semanticSupport:'not_verified'});
});
