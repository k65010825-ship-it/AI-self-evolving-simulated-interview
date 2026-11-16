import type{EvaluationOutputSchema}from'../../../../packages/contracts/src/evaluation.ts';
import type{EvaluationDiagnostic}from'../../../../packages/contracts/src/evaluation-diagnostic.ts';
import type{z}from'zod';
/** Classification only, after the canonical ScoringContextSchema has already rejected the input. */
export function evidenceFailureReason(answer:string,evidence:z.infer<typeof EvaluationOutputSchema>['evidence']):EvaluationDiagnostic['reason'] {
 if(new Set(evidence.map(e=>e.id)).size!==evidence.length)return'evidence-id-duplicate';
 if(evidence.some(e=>e.end<=e.start||e.end>answer.length))return'evidence-offset-out-of-range';
 for(const e of evidence)if(answer.slice(e.start,e.end)!==e.excerpt){
  const first=answer.indexOf(e.excerpt);if(first<0)return'evidence-quote-absent';
  if(answer.indexOf(e.excerpt,first+1)>=0)return'evidence-quote-ambiguous';
  return'evidence-offset-mismatch';
 }
 return'invalid-evidence';
}
