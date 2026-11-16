import {observationScenario} from './observation-fixture.ts';
/** Synthetic annotated spans; not independent labels or real model extraction. */
export function conditionScopeScenario(role:'java-backend'|'web-frontend',variant:string){
 const f=observationScenario(role),java=role==='java-backend';
 const condition=java?'初值99':'相同交互',action=java?'并发申请':'对照测量',target=java?'容量计数器':'列表组件',metric=java?'成功数':'actualDuration',value=variant==='decimal'?(java?'最多1.5':'下降20.5%'):java?'最多1':'下降20%';
 const expectation='预期'+metric+value,procedure=action+target;
 const texts:Record<string,string>={
  before:`假设${condition}下${procedure}，${expectation}。`,
  decimal:`假设${condition}下${procedure}，${expectation}。`,
  after:`假设${procedure}，${expectation}（${condition}）。`,
  history:`旧实验没有结论。假设${condition}下${procedure}，${expectation}。`,
  old:`${condition}只是旧实验条件。另在未说明条件下${procedure}，${expectation}。`,
  else:`若${condition}则仅作记录，否则${procedure}，${expectation}。`,
  separate:`${condition}只是背景；在未说明条件下${procedure}，${expectation}。`,
  another:`${condition}只做记录，另在未说明条件下${procedure}，${expectation}。`,
  distant:`假设${condition}下${'说明'.repeat(110)}${procedure}，${expectation}。`,
  'known-limit':`${condition}只是旁注，主实验${procedure}，${expectation}。`,
 };
 const answer=texts[variant]!;
 const ref=(word:string)=>({evidenceId:'unit',start:answer.indexOf(word),end:answer.indexOf(word)+word.length});
 const binding={...f.binding,action:ref(action),target:ref(target),expectation:ref(expectation),observation:{metric:ref(metric),value:ref(value),condition:ref(condition)}};
 const evidence=[{id:'unit',start:0,end:answer.length,excerpt:answer}];
 const assessment={...f.assessment,evidence,criterionScores:[{...f.assessment.criterionScores[0]!,verificationBinding:binding}]};
 return {...f,binding,evidence,answer,assessment,input:{...f.input,answer:{...f.input.answer,text:answer}}};
}
