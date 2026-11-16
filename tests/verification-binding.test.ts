import {test,expect} from 'bun:test';
import {inspectVerificationBinding} from '../packages/interview-domain/src/verification-binding.ts';
import {createScoringExecutor} from '../apps/agent/src/tools/scoring-executor.ts';
export const goal={id:'java-idempotency',version:'1',actionAliases:['并发重放'],targetAliases:['同一幂等键'],observationAliases:['订单数']};
function fixture(text='假设并发重放同一幂等键，预期订单数=1。'){
 const ref=(fragment:string)=>({evidenceId:'e',start:text.indexOf(fragment),end:text.indexOf(fragment)+fragment.length});
 return {text,evidence:[{id:'e',start:0,end:text.length,excerpt:text}],binding:{goalId:goal.id,goalVersion:goal.version,mode:'proposed' as const,
  action:ref('并发重放'),target:ref('同一幂等键'),expectation:ref('预期订单数=1')}};
}
test('hypothetical procedure binds action, target and observation to one exact evidence unit',()=>{
 const f=fixture();expect(inspectVerificationBinding(goal,f.binding,f.evidence,['e'],f.text)).toEqual({status:'bound',semanticSupport:'not_verified'});
});
test('goal mismatch and structurally forged references are rejected, never repaired',()=>{
 const f=fixture();for(const binding of [{...f.binding,goalVersion:'stale'},{...f.binding,action:{...f.binding.action,evidenceId:'invented'}},{...f.binding,target:{...f.binding.target,start:0,end:1000}}]){
  expect(inspectVerificationBinding(goal,binding,f.evidence,['e'],f.text).status).toBe('invalid');}
});
test('unrelated visible result does not satisfy a technical observation target',()=>{
 const f=fixture('假设并发重放同一幂等键，预期订单数=1。检查按钮颜色为蓝色。');
 f.binding.expectation={evidenceId:'e',start:f.text.indexOf('按钮颜色'),end:f.text.indexOf('按钮颜色')+4};
 expect(inspectVerificationBinding(goal,f.binding,f.evidence,['e'],f.text).status).toBe('insufficient');
});
test('executor abstains on missing goal binding and retains a valid procedure even for a substantive zero',async()=>{
 const f=fixture(),rubric={id:'r',version:'binding-1',roleId:'java-backend',scope:'technical-content',criteria:[{id:'v',dimension:'verification',verificationGoal:goal,required:true,maxScore:4,weight:1}]};
 const execute=createScoringExecutor({userId:'u',runId:'r',attemptId:'a',roleId:'java-backend',deadlineAt:1000,answerId:'a',answerText:f.text,evidence:f.evidence},[rubric],{allowRequiredAbstention:true});
 const command=(binding?:unknown)=>({rubricId:'r',rubricVersion:'binding-1',criterionScores:[{criterionId:'v',score:0,evidenceIds:['e'],...(binding?{verificationBinding:binding}:{})}]});
 const missing=await execute('one',command(),undefined,()=>1);expect(missing.data?.normalizedScore).toBeNull();
 const valid=await execute('two',command(f.binding),undefined,()=>1);expect(valid.data?.normalizedScore).toBe(0);expect(valid.data?.dimensions[0]?.verificationBinding).toEqual(f.binding);
 const invalid=await execute('three',command({...f.binding,goalVersion:'stale'}),undefined,()=>1);expect(invalid.status).toBe('error');
});

import {RubricSchema} from '../packages/contracts/src/scoring.ts';
test('old rubrics do not implicitly activate binding and the model cannot inject an undeclared goal',()=>{
 const f=fixture();expect(inspectVerificationBinding(undefined,undefined,f.evidence,['e'],f.text).status).toBe('not_required');
 expect(inspectVerificationBinding(undefined,f.binding,f.evidence,['e'],f.text).status).toBe('invalid');
 expect(RubricSchema.safeParse({id:'r',version:'1',roleId:'java-backend',scope:'technical-content',criteria:[{id:'v',dimension:'correctness',verificationGoal:goal,maxScore:4,weight:1,required:true}]}).success).toBe(false);
});
test('three parts cannot be assembled from different evidence units or overlapping whole paragraphs',()=>{
 const f=fixture(),split=f.binding.expectation.start;
 const evidence=[{id:'e',start:0,end:split,excerpt:f.text.slice(0,split)},{id:'other',start:split,end:f.text.length,excerpt:f.text.slice(split)}];
 expect(inspectVerificationBinding(goal,{...f.binding,expectation:{...f.binding.expectation,evidenceId:'other'}},evidence,['e','other'],f.text).status).toBe('invalid');
 expect(inspectVerificationBinding(goal,{...f.binding,target:f.binding.action},f.evidence,['e'],f.text).status).toBe('invalid');
});
test('explicitly denied action does not become a performed check; a separate hypothetical plan remains eligible',()=>{
 const original=fixture(),prefix='我没有',text=prefix+original.text.slice(2),move=(r:typeof original.binding.action)=>({...r,start:r.start+1,end:r.end+1});
 const binding={...original.binding,action:move(original.binding.action),target:move(original.binding.target),expectation:move(original.binding.expectation)};
 expect(inspectVerificationBinding(goal,binding,[{id:'e',start:0,end:text.length,excerpt:text}],['e'],text).status).toBe('insufficient');
 const hypothetical=fixture();expect(inspectVerificationBinding(goal,hypothetical.binding,hypothetical.evidence,['e'],hypothetical.text).status).toBe('bound');
});
test('a valid literal chain can express an incorrect expected result and retain a grounded zero',async()=>{
 const f=fixture(),text=f.text.replace('订单数=1','订单数=2');
 const execute=createScoringExecutor({userId:'u',runId:'r',attemptId:'a',roleId:'java-backend',deadlineAt:1000,answerId:'a',answerText:text,evidence:[{...f.evidence[0],excerpt:text}]},
 [{id:'r',version:'binding-1',roleId:'java-backend',scope:'technical-content',criteria:[{id:'v',dimension:'verification',verificationGoal:goal,required:true,maxScore:4,weight:1}]}]);
 const result=await execute('c',{rubricId:'r',rubricVersion:'binding-1',criterionScores:[{criterionId:'v',score:0,evidenceIds:['e'],verificationBinding:f.binding}]},undefined,()=>1);
 expect(result.data?.normalizedScore).toBe(0);expect(result.data?.complete).toBe(true);
});

test('a bound hypothetical recommendation is not rejected merely because the old heuristic lacks its action verb',async()=>{
 const f=fixture(),prefix='建议',text=prefix+f.text,move=(r:typeof f.binding.action)=>({...r,start:r.start+prefix.length,end:r.end+prefix.length});
 const binding={...f.binding,action:move(f.binding.action),target:move(f.binding.target),expectation:move(f.binding.expectation)};
 const execute=createScoringExecutor({userId:'u',runId:'r',attemptId:'a',roleId:'java-backend',deadlineAt:1000,answerId:'a',answerText:text,evidence:[{id:'e',start:0,end:text.length,excerpt:text}]},
 [{id:'r',version:'binding-1',roleId:'java-backend',scope:'technical-content',criteria:[{id:'v',dimension:'verification',verificationGoal:goal,required:true,maxScore:4,weight:1}]}]);
 const result=await execute('c',{rubricId:'r',rubricVersion:'binding-1',criterionScores:[{criterionId:'v',score:3,evidenceIds:['e'],verificationBinding:binding}]},undefined,()=>1);
 expect(result.data?.normalizedScore).toBe(.75);
});
test('UTF-16 spans remain tied to original text containing a surrogate pair',()=>{
 const f=fixture(),prefix='😀',text=prefix+f.text,move=(r:typeof f.binding.action)=>({...r,start:r.start+prefix.length,end:r.end+prefix.length});
 const binding={...f.binding,action:move(f.binding.action),target:move(f.binding.target),expectation:move(f.binding.expectation)};
 expect(inspectVerificationBinding(goal,binding,[{id:'e',start:0,end:text.length,excerpt:text}],['e'],text).status).toBe('bound');
});
