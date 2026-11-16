import {z} from 'zod';
import {contentHash,canonical} from '../answers/validation.ts';
import {collectDeliverySources} from '../delivery/sources.ts';
import {loopCases,scenarios,type Step} from './cases.ts';
const StepSchema=z.object({status:z.enum(['needs_clarification','abstained','scored','cancelled']),reason:z.enum(['evidence_insufficient','clarification_limit','time_budget']).nullable(),template:z.literal('observation-v1').nullable(),score:z.number().min(0).max(1).nullable(),observations:z.number().int().min(0).max(1),evaluatorCalls:z.number().int().min(0).max(1)}).strict().superRefine((s,ctx)=>{
 const valid=s.status==='scored'?s.score!==null&&s.observations===1&&s.reason===null&&s.template===null:
  s.score===null&&s.observations===0&&(s.status==='needs_clarification'?s.reason==='evidence_insufficient'&&s.template==='observation-v1':
   s.template===null&&(s.status==='cancelled'?s.reason===null&&s.evaluatorCalls===0:s.reason==='time_budget'||s.reason==='clarification_limit'));
 if(!valid)ctx.addIssue({code:'custom',message:'Invalid trace projection.'});
});
const RowSchema=z.object({id:z.string().max(100),role:z.enum(['java-backend','web-frontend']),scenario:z.enum(scenarios),lane:z.enum(['regression','known-limit']),steps:z.array(StepSchema).min(1).max(2),evaluatorCalls:z.number().int().min(0).max(2),outcome:z.enum(['matched','failed','requires-semantic-review'])}).strict();
export type LoopRow=z.infer<typeof RowSchema>;
export function summarizeLoop(rows:readonly LoopRow[]){
 const regressions=rows.filter(r=>r.lane==='regression'),clarified=regressions.filter(r=>r.steps.some(s=>s.status==='needs_clarification'));
 const scored=clarified.filter(r=>r.steps.at(-1)!.status==='scored');
 return {total:rows.length,regressions:regressions.length,matched:regressions.filter(r=>r.outcome==='matched').length,knownLimits:rows.length-regressions.length,
  clarifiedRegressionSessions:clarified.length,scoredAfterClarification:scored.length,zeroScoreAfterClarification:scored.filter(r=>r.steps.at(-1)!.score===0).length,
  structuralClosureRate:clarified.length?scored.length/clarified.length:null,
  pending:regressions.filter(r=>r.steps.at(-1)!.status==='needs_clarification').length,
  limitAbstentions:regressions.filter(r=>r.steps.at(-1)!.reason==='clarification_limit').length,
  timeAbstentions:regressions.filter(r=>r.steps.at(-1)!.reason==='time_budget').length,
  cancelled:regressions.filter(r=>r.steps.at(-1)!.status==='cancelled').length,
  evaluatorCalls:rows.reduce((sum,r)=>sum+r.evaluatorCalls,0)};
}
export function projectLoopRow(c:typeof loopCases[number],steps:Step[]):LoopRow{
 return {id:c.id,role:c.role,scenario:c.scenario,lane:c.lane,steps,evaluatorCalls:steps.reduce((sum,s)=>sum+s.evaluatorCalls,0),
  outcome:c.lane==='known-limit'?'requires-semantic-review':canonical(steps)===canonical(c.expected)?'matched':'failed'};
}
export async function buildLoopReport(rows:LoopRow[]){
 const summary=summarizeLoop(rows),body={version:1 as const,origin:'assistant-authored-synthetic-development' as const,
  annotationMode:'injected-outputs-and-spans' as const,datasetDigest:contentHash(loopCases),sourceManifest:await collectDeliverySources(process.cwd()),
  rows,summary,status:summary.matched===summary.regressions?'passed-regressions-with-known-limits' as const:'failed-regressions' as const,
  liveModelCalls:0 as const,humanReferenceCount:0 as const,qualityClaimEligible:false as const,semanticSupport:'not_verified' as const};
 return {...body,digest:contentHash(body)};
}
export type LoopReport=Awaited<ReturnType<typeof buildLoopReport>>;
const Input=z.object({version:z.literal(1),origin:z.literal('assistant-authored-synthetic-development'),annotationMode:z.literal('injected-outputs-and-spans'),
 datasetDigest:z.string().regex(/^[a-f0-9]{64}$/),sourceManifest:z.array(z.object({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(5000),
 rows:z.array(RowSchema).length(16),summary:z.unknown(),status:z.enum(['passed-regressions-with-known-limits','failed-regressions']),liveModelCalls:z.literal(0),humanReferenceCount:z.literal(0),qualityClaimEligible:z.literal(false),semanticSupport:z.literal('not_verified'),digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
/** Read-only projection/source verification, never a rerun or proof of who executed the report. */
export async function verifyClarificationLoop(raw:unknown):Promise<LoopReport>{
 try{
  if(Buffer.byteLength(JSON.stringify(raw))>4*1024*1024)throw Error();const p=Input.parse(raw),{digest,...body}=p;
  if(contentHash(body)!==digest)throw Error();
  for(const [index,c]of loopCases.entries()){
   const row=p.rows[index]!;if(canonical(row)!==canonical(projectLoopRow(c,row.steps)))throw Error();
   // Unexpected transitions remain auditable failed artifacts; they cannot retain a matched outcome.
  }
  const expected=await buildLoopReport(p.rows);if(canonical(expected)!==canonical(p))throw Error();return expected;
 }catch{throw Error('CLARIFICATION_LOOP_INVALID');}
}
