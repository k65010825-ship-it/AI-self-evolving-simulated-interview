import {test,expect} from 'bun:test';
import {inspectVerificationBinding} from '../packages/interview-domain/src/verification-binding.ts';
import {VerificationGoalSchema,VerificationBindingSchema} from '../packages/contracts/src/verification-binding.ts';
function sample(kind:'count'|'duration'='count',suffix?:string){
 const text=kind==='count'?'假设初值99时并发申请容量计数器，预期成功数最多1。':'假设相同交互下对照测量列表组件，预期actualDuration下降20%。';
 const answer=text+(suffix??''),span=(word:string)=>({evidenceId:'unit',start:answer.indexOf(word),end:answer.indexOf(word)+word.length});
 const goal={id:kind,version:'typed-1',actionAliases:[kind==='count'?'并发申请':'对照测量'],targetAliases:[kind==='count'?'容量计数器':'列表组件'],observationAliases:[kind==='count'?'成功数':'actualDuration'],
  observationPolicy:{kind,conditionAliases:[kind==='count'?'初值99':'相同交互']}};
 const binding={goalId:kind,goalVersion:'typed-1',mode:'proposed' as const,action:span(kind==='count'?'并发申请':'对照测量'),target:span(kind==='count'?'容量计数器':'列表组件'),expectation:span(kind==='count'?'预期成功数最多1':'预期actualDuration下降20%'),
  observation:{metric:span(kind==='count'?'成功数':'actualDuration'),value:span(kind==='count'?'最多1':'下降20%'),condition:span(kind==='count'?'初值99':'相同交互')}};
 return {answer,goal,binding,evidence:[{id:'unit',start:0,end:answer.length,excerpt:answer}],span};
}
test('explicit count and duration policies bind numeric/change values and answer conditions',()=>{
 for(const kind of ['count','duration']as const){const f=sample(kind);expect(VerificationGoalSchema.safeParse(f.goal).success).toBe(true);expect(VerificationBindingSchema.safeParse(f.binding).success).toBe(true);
 expect(inspectVerificationBinding(f.goal,f.binding,f.evidence,['unit'],f.answer).status).toBe('bound');}
});
test('a goal requiring typed observation cannot fall back to metric-name-only matching',()=>{
 const f=sample();const {observation,...binding}=f.binding;
 expect(inspectVerificationBinding(f.goal,binding,f.evidence,['unit'],f.answer).status).toBe('insufficient');
});
test('metric-caption style changes cannot act as numeric count or render-duration observations',()=>{
 for(const kind of ['count','duration']as const){const f=sample(kind);const metric=kind==='count'?'成功数':'actualDuration';
  const old=kind==='count'?'预期成功数最多1':'预期actualDuration下降20%';const replacement=`预期${metric}标题的字号增加2`;
  const answer=f.answer.replace(old,replacement),ref=(word:string)=>({evidenceId:'unit',start:answer.indexOf(word),end:answer.indexOf(word)+word.length});
  const binding={...f.binding,expectation:ref(replacement),observation:{...f.binding.observation,metric:ref(metric),value:ref(kind==='count'?'2':'增加')}};
  expect(inspectVerificationBinding(f.goal,binding,[{id:'unit',start:0,end:answer.length,excerpt:answer}],['unit'],answer).status).toBe('insufficient');
 }
});
test('typed parts cannot cite outside the expectation or a different registered unit',()=>{
 const f=sample('count','另一个指标=2。');
 for(const observation of [{...f.binding.observation,value:f.span('2')},{...f.binding.observation,value:{...f.binding.observation.value,evidenceId:'other'}}]){
  expect(inspectVerificationBinding(f.goal,{...f.binding,observation},f.evidence,['unit'],f.answer).status).toBe('invalid');}
});

test('reading a numeric result from a label is allowed when it is not a style change',()=>{
 const f=sample(),old='预期成功数最多1',replacement='预期成功数标签显示1',answer=f.answer.replace(old,replacement);
 const ref=(word:string)=>({evidenceId:'unit',start:answer.indexOf(word),end:answer.indexOf(word)+word.length});
 const binding={...f.binding,expectation:ref(replacement),observation:{...f.binding.observation,metric:ref('成功数'),value:ref('1')}};
 expect(inspectVerificationBinding(f.goal,binding,[{id:'unit',start:0,end:answer.length,excerpt:answer}],['unit'],answer).status).toBe('bound');
});

test('legacy goals reject undeclared observation details instead of silently accepting or demoting them',()=>{
 const f=sample();const {observationPolicy,...goal}=f.goal;
 expect(inspectVerificationBinding(goal,f.binding,f.evidence,['unit'],f.answer).status).toBe('invalid');
});

test('only exact host predicates permit metric/value overlap',()=>{
 const f=sample(),answer=f.answer.replace('成功数最多1','成功数没有超额');
 const ref=(word:string)=>({evidenceId:'unit',start:answer.indexOf(word),end:answer.indexOf(word)+word.length});
 const goal={...f.goal,observationAliases:['超额'],observationPolicy:{...f.goal.observationPolicy,predicateAliases:['没有超额']}};
 const binding={...f.binding,expectation:ref('预期成功数没有超额'),observation:{...f.binding.observation,metric:ref('超额'),value:ref('没有超额')}};
 const evidence=[{id:'unit',start:0,end:answer.length,excerpt:answer}];
 expect(inspectVerificationBinding(goal,binding,evidence,['unit'],answer).status).toBe('bound');
 expect(inspectVerificationBinding({...goal,observationPolicy:{...goal.observationPolicy,predicateAliases:[]}},binding,evidence,['unit'],answer).status).toBe('invalid');
});
