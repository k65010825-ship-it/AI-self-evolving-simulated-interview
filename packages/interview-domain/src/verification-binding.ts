import {inspectObservationValue} from './observation-value.ts';
import type {VerificationGoal,VerificationBinding,BindingInvalidDetail,BindingSpanConflict} from '../../contracts/src/verification-binding.ts';
import {describeSpanConflict} from './span-conflict.ts';
export type VerificationCheck=
 |{status:'bound';semanticSupport:'not_verified'}
 |{status:'not_required';semanticSupport:'not_verified'}
 |{status:'invalid';reason:'verification-binding-invalid';detail:BindingInvalidDetail;conflict?:BindingSpanConflict}
 |{status:'insufficient';reason:'verification-binding-missing'|'verification-action-absent'|'verification-target-mismatch'|'verification-observation-mismatch'|'verification-observation-detail-missing'|'verification-observation-value-invalid'|'verification-observation-context-mismatch'};
const fold=(value:string)=>value.normalize('NFKC').toLowerCase();
// Aliases are literals from the host rubric, never regular expressions from the model.
const matches=(value:string,aliases:readonly string[])=>aliases.some(alias=>fold(value).includes(fold(alias)));
/** Structural/literal binding only. A bound triple does not certify correctness or actual execution. */
export function inspectVerificationBinding(goal:VerificationGoal|undefined,binding:VerificationBinding|undefined,
 evidence:readonly {id:string;start:number;end:number;excerpt:string}[],citedIds:readonly string[],answerText:string):VerificationCheck{
 if(!goal)return binding?{status:'invalid',reason:'verification-binding-invalid',detail:'unexpected-binding'}:{status:'not_required',semanticSupport:'not_verified'};
 if(!binding)return {status:'insufficient',reason:'verification-binding-missing'};
 const invalid=(detail:BindingInvalidDetail):Extract<VerificationCheck,{status:'invalid'}>=>({status:'invalid',reason:'verification-binding-invalid',detail});
 if(binding.goalId!==goal.id)return invalid('goal-id-mismatch');
 if(binding.goalVersion!==goal.version)return invalid('goal-version-mismatch');
 if(binding.observation&&!goal.observationPolicy)return invalid('unexpected-observation');
 const parts=[binding.action,binding.target,binding.expectation],unit=evidence.find(e=>e.id===binding.action.evidenceId);
 if(!unit)return invalid('unit-missing');
 if(!citedIds.includes(unit.id))return invalid('unit-uncited');
 if(unit.start<0||unit.end>answerText.length||answerText.slice(unit.start,unit.end)!==unit.excerpt)return invalid('unit-invalid');
 if(parts.some(p=>p.evidenceId!==unit.id))return invalid('span-unit-mismatch');
 if(parts.some(p=>!Number.isSafeInteger(p.start)||!Number.isSafeInteger(p.end)||p.start<unit.start||p.end>unit.end||p.end<=p.start||p.end-p.start>500))return invalid('span-range-invalid');
 const labels=['action','target','expectation'] as const;
 for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++){
  const a=parts[i]!,b=parts[j]!;if(a.start<b.end&&b.start<a.end)return {...invalid('span-overlap'),conflict:describeSpanConflict([labels[i]!,labels[j]!],a,b)};
 }
 const text=(p:typeof binding.action)=>answerText.slice(p.start,p.end);
 const action=text(binding.action),prefix=answerText.slice(Math.max(unit.start,binding.action.start-10),binding.action.start);
 // Narrow explicit denial only; not a general negation or semantic parser.
 if(!matches(action,goal.actionAliases)||/(?:没有|并未|未曾|没做过|没有做过)\s*$|\b(?:never|did not|didn't)\s*$/i.test(prefix)||/^(?:没有|并未|未曾|没做过|没有做过)\s*|^\s*(?:never|did not|didn't)\b/i.test(action))
  return {status:'insufficient',reason:'verification-action-absent'};
 if(!matches(text(binding.target),goal.targetAliases))return {status:'insufficient',reason:'verification-target-mismatch'};
 if(!matches(text(binding.expectation),goal.observationAliases))return {status:'insufficient',reason:'verification-observation-mismatch'};
 return inspectObservationValue(goal,binding,unit,answerText);
}
