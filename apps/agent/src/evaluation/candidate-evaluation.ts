import {z} from 'zod';
import {QuotedEvaluationSchema,groundQuotedEvaluation} from './quoted-spans.ts';
import {EvaluationOutputSchema} from '../../../../packages/contracts/src/evaluation.ts';
import {inspectVerificationBinding} from '../../../../packages/interview-domain/src/verification-binding.ts';
import type {VerificationBinding} from '../../../../packages/contracts/src/verification-binding.ts';
import {hasVerificationSentenceBoundary,type VerificationCandidates} from './verification-candidates.ts';
import type {EvaluationDiagnostic} from '../../../../packages/contracts/src/evaluation-diagnostic.ts';
const id=z.string().regex(/^vc-[a-f0-9]{24}$/);
export const VerificationSelectionSchema=z.object({mode:z.enum(['proposed','reported']),action:id,target:id,expectation:id,observation:z.object({metric:id,value:id,condition:id}).strict().optional()}).strict();
export const CandidateEvaluationSchema=QuotedEvaluationSchema.extend({criterionScores:z.array(QuotedEvaluationSchema.shape.criterionScores.element.omit({verificationBinding:true}).extend({verificationSelection:VerificationSelectionSchema.optional()})).max(20)});
type Output=z.infer<typeof EvaluationOutputSchema>;
type Result={ok:true;output:Output}|{ok:false;stage:'schema'|'evidence';reason:'invalid-schema'|'candidate-selection-invalid';candidateIssue?:EvaluationDiagnostic['candidateIssue']};
/** Explicit candidate wire -> canonical spans. Missing/invalid selectors are never auto-filled or repaired. */
export function groundCandidateEvaluation(raw:unknown,registry:VerificationCandidates):Result{
 const parsed=CandidateEvaluationSchema.safeParse(raw);if(!parsed.success)return{ok:false,stage:'schema',reason:'invalid-schema'};
 const wire=parsed.data,deny=(candidateIssue:NonNullable<EvaluationDiagnostic['candidateIssue']>):Result=>({ok:false,stage:'evidence',reason:'candidate-selection-invalid',candidateIssue});
 if(wire.evidence.some(e=>e.id.startsWith('vc-unit-')))return deny('evidence-conflict');
 const ordinary=groundQuotedEvaluation({...wire,criterionScores:wire.criterionScores.map(({verificationSelection,...c})=>c)},registry.answer);
 if(!ordinary.ok)return deny('quote-evidence-invalid');
 const output=ordinary.output;
 for(const [i,c]of wire.criterionScores.entries()){
  const selection=c.verificationSelection,goal=registry.goalFor(c.criterionId);
  if(c.score===null&&c.evidenceIds.length)return deny('null-evidence');
  if(goal&&c.score!==null&&c.evidenceIds.length)return deny('goal-evidence-not-empty');
  if(!selection){if(goal&&c.score!==null)return deny('selection-missing');continue;}
  if(!goal||c.score===null)return deny('unexpected-selection');
  if(Boolean(goal.observationPolicy)!==Boolean(selection.observation))return deny('observation-mismatch');
  const parts=['action','target','expectation',...(selection.observation?['metric','value','condition']as const:[])]as const;
  const positions=new Map<string,{start:number;end:number}>();
  for(const part of parts){const key=part==='action'||part==='target'||part==='expectation'?selection[part]:selection.observation![part];const span=registry.resolve(c.criterionId,part,key);if(!span)return deny('unknown-or-wrong-part');positions.set(part,span);}
  const chosen=[...positions.values()],left=Math.min(...chosen.map(p=>p.start)),right=Math.max(...chosen.map(p=>p.end));
  if(hasVerificationSentenceBoundary(registry.answer,left,right))return deny('cross-sentence');
  const bounds=registry.evidenceFor(chosen),evidenceId='vc-unit-'+i;
  const unit={id:evidenceId,...bounds,excerpt:registry.answer.slice(bounds.start,bounds.end)},span=(part:string)=>({evidenceId,...positions.get(part)!});
  const binding:VerificationBinding={goalId:goal.id,goalVersion:goal.version,mode:selection.mode,action:span('action'),target:span('target'),expectation:span('expectation'),...(selection.observation?{observation:{metric:span('metric'),value:span('value'),condition:span('condition')}}:{})};
  if(inspectVerificationBinding(goal,binding,[unit],[evidenceId],registry.answer).status!=='bound')return deny('binding-guard');
  output.evidence.push(unit);output.criterionScores[i]={...output.criterionScores[i]!,evidenceIds:[...c.evidenceIds,evidenceId],verificationBinding:binding};
 }
 const final=EvaluationOutputSchema.safeParse(output);return final.success?{ok:true,output:final.data}:deny('binding-guard');
}
