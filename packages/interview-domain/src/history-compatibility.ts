import type { z } from 'zod';
import type { HistoricalEvidenceSchema,InterviewState } from '../../contracts/src/interview-state.ts';
import { HistoryCompatibilityAuditSchema,type HistoryCompatibilityPolicy } from '../../contracts/src/history-compatibility.ts';
type Evidence=z.infer<typeof HistoricalEvidenceSchema>;
const compareId=(a:string,b:string)=>a<b?-1:a>b?1:0;
/** Stable first-anchor ordering shared by estimates and recall, including equal-time observations. */
export const sortHistoricalEvidence=(evidence:Evidence[])=>[...evidence].sort((a,b)=>a.observedAt-b.observedAt||compareId(a.sessionId,b.sessionId)||compareId(a.observationId,b.observationId));
/** Callers validate the snapshot/state and policy before deriving this read-only view. */
export function historyEligibility(evidence:Evidence[],policy?:HistoryCompatibilityPolicy){
 const allowed=new Set(policy?.allowed.map(a=>JSON.stringify([a.skillId,a.rubricId,a.rubricVersion])));
 const anchors=new Map<string,Evidence>();
 // Existing unpinned sessions keep their original first-row estimate semantics.
 for(const e of policy?sortHistoricalEvidence(evidence):evidence)if(!anchors.has(e.questionId))anchors.set(e.questionId,e);
 const eligibleQuestionIds=new Set([...anchors].filter(([,e])=>!e.assistance&&(!policy||allowed.has(JSON.stringify([e.skillId,e.rubricId,e.rubricVersion])))).map(([id])=>id));
 const eligibleCount=evidence.filter(e=>eligibleQuestionIds.has(e.questionId)).length;
 const assistedExcludedCount=evidence.filter(e=>anchors.get(e.questionId)?.assistance).length;
 const audit=HistoryCompatibilityAuditSchema.parse({mode:policy?'strict':'legacy-unchecked',policyId:policy?.id??null,
  sourceCount:evidence.length,eligibleCount,excludedCount:evidence.length-eligibleCount,...(assistedExcludedCount?{assistedExcludedCount}:{}),authority:'host-declared-unverified',compatibilityVerified:false});
 return{eligibleQuestionIds,anchors,audit};
}
export const describeHistoryCompatibility=(state:InterviewState)=>historyEligibility(state.priorEvidence,state.historyCompatibility).audit;
