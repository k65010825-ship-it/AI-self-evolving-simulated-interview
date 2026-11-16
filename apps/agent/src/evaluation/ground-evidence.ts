import type{z}from'zod';
import type{EvaluationOutputSchema}from'../../../../packages/contracts/src/evaluation.ts';
type Output=z.infer<typeof EvaluationOutputSchema>;
/** Host-authoritative UTF-16 positions from exact unique quotes; no fuzzy/semantic repair. */
export function groundUniqueEvidence(output:Output,answer:string) {
 if(new Set(output.evidence.map(e=>e.id)).size!==output.evidence.length)return{ok:false as const,reason:'evidence-id-duplicate' as const};
 const evidence:Output['evidence']=[];let changed=false;
 for(const e of output.evidence){
  const start=answer.indexOf(e.excerpt);
  if(start<0)return{ok:false as const,reason:'evidence-quote-absent' as const};
  // +1 detects overlapping matches too (e.g. 哈哈 in 哈哈哈).
  if(answer.indexOf(e.excerpt,start+1)>=0)return{ok:false as const,reason:'evidence-quote-ambiguous' as const};
  const end=start+e.excerpt.length;changed||=start!==e.start||end!==e.end;
  evidence.push({...e,start,end});
 }
 return{ok:true as const,output:{...output,evidence},changed};
}
