import {z} from 'zod';
import {EvaluationOutputSchema} from '../../../../packages/contracts/src/evaluation.ts';
import {VerificationBindingSchema} from '../../../../packages/contracts/src/verification-binding.ts';
import type {QuoteIssueSchema} from '../../../../packages/contracts/src/evaluation-diagnostic.ts';
const context=z.object({before:z.string().max(120).default(''),after:z.string().max(120).default('')}).strict().refine(c=>c.before.length+c.after.length>0,'At least one nonempty anchor is required.');
const id=z.string().min(1).max(100),ref=z.object({evidenceId:id,excerpt:z.string().min(1).max(500),context:context.optional()}).strict();
const binding=VerificationBindingSchema.extend({action:ref,target:ref,expectation:ref,
 observation:z.object({metric:ref,value:ref,condition:ref}).strict().optional()});
/** Internal model wire only. Public/domain results remain canonical numeric UTF-16 spans. */
export const QuotedEvaluationSchema=EvaluationOutputSchema.extend({
 evidence:z.array(EvaluationOutputSchema.shape.evidence.element.pick({id:true,excerpt:true}).extend({context:context.optional()})).max(100),
 criterionScores:z.array(EvaluationOutputSchema.shape.criterionScores.element.extend({verificationBinding:binding.optional()})).max(20),
});
type Output=z.infer<typeof EvaluationOutputSchema>;
type QuoteIssue=z.infer<typeof QuoteIssueSchema>;
type Reason='invalid-schema'|'evidence-id-duplicate'|'evidence-quote-absent'|'evidence-quote-ambiguous'|'evidence-context-mismatch'|'binding-quote-absent'|'binding-quote-ambiguous'|'binding-context-mismatch'|'binding-unit-uncited'|'binding-unit-mismatch';
type Result={ok:true;output:Output}|{ok:false;stage:'schema'|'evidence';reason:Reason;quoteIssue?:QuoteIssue};
/** Literal adjacent anchors only. Candidates are capped at two: none, unique, ambiguous. */
function locate(scope:string,quote:{excerpt:string;context?:z.infer<typeof context>|undefined}){
 let start=-1,count=0,quoteFound=false;
 for(let at=scope.indexOf(quote.excerpt);at>=0;at=scope.indexOf(quote.excerpt,at+1)){
  quoteFound=true;const c=quote.context,end=at+quote.excerpt.length;
  if(c&&(at<c.before.length||end+c.after.length>scope.length||scope.slice(at-c.before.length,at)!==c.before||scope.slice(end,end+c.after.length)!==c.after))continue;
  start=at;if(++count===2)break;
 }
 return {start,quoteFound,matches:count===0?'none' as const:count===1?'one' as const:'multiple' as const};
}
export function groundQuotedEvaluation(value:unknown,answer:string):Result{
 const parsed=QuotedEvaluationSchema.safeParse(value);if(!parsed.success)return {ok:false,stage:'schema',reason:'invalid-schema'};
 const wire=parsed.data,deny=(reason:Reason,quoteIssue?:QuoteIssue):Result=>({ok:false,stage:'evidence',reason,...(quoteIssue?{quoteIssue}:{})});
 if(new Set(wire.evidence.map(e=>e.id)).size!==wire.evidence.length)return deny('evidence-id-duplicate');
 const evidence:Output['evidence']=[];
 for(const e of wire.evidence){const found=locate(answer,e),detail:QuoteIssue={part:'evidence',matches:found.matches};
  if(found.matches==='none')return deny(found.quoteFound?'evidence-context-mismatch':'evidence-quote-absent',detail);
  if(found.matches==='multiple')return deny('evidence-quote-ambiguous',detail);
  evidence.push({id:e.id,excerpt:e.excerpt,start:found.start,end:found.start+e.excerpt.length});
 }
 const scores:Output['criterionScores']=[];
 for(const c of wire.criterionScores){const b=c.verificationBinding;if(!b){scores.push({...c,verificationBinding:undefined});continue;}
  const unit=evidence.find(e=>e.id===b.action.evidenceId);if(!unit||!c.evidenceIds.includes(unit.id))return deny('binding-unit-uncited');
  const refs:{part:QuoteIssue['part'];value:z.infer<typeof ref>}[]=[{part:'action',value:b.action},{part:'target',value:b.target},{part:'expectation',value:b.expectation},
   ...(b.observation?[{part:'metric' as const,value:b.observation.metric},{part:'value' as const,value:b.observation.value},{part:'condition' as const,value:b.observation.condition}]:[])];
  const wrong=refs.find(r=>r.value.evidenceId!==unit.id);if(wrong)return deny('binding-unit-mismatch',{part:wrong.part,matches:'none'});
  const positions=new Map<z.infer<typeof ref>,{evidenceId:string;start:number;end:number}>();
  for(const {part,value:r} of refs){const found=locate(unit.excerpt,r),detail:QuoteIssue={part,matches:found.matches};
   if(found.matches==='none')return deny(found.quoteFound?'binding-context-mismatch':'binding-quote-absent',detail);
   if(found.matches==='multiple')return deny('binding-quote-ambiguous',detail);
   positions.set(r,{evidenceId:unit.id,start:unit.start+found.start,end:unit.start+found.start+r.excerpt.length});
  }
  const span=(r:z.infer<typeof ref>)=>positions.get(r)!;
  scores.push({...c,verificationBinding:{goalId:b.goalId,goalVersion:b.goalVersion,mode:b.mode,action:span(b.action),target:span(b.target),expectation:span(b.expectation),
   ...(b.observation?{observation:{metric:span(b.observation.metric),value:span(b.observation.value),condition:span(b.observation.condition)}}:{})}});
 }
 return {ok:true,output:EvaluationOutputSchema.parse({...wire,evidence,criterionScores:scores})};
}
