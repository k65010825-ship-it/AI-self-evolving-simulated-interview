import { test,expect } from 'bun:test';
import { createInterviewState,estimateSkills,recordObservation } from '../apps/agent/src/planning/interview-state.ts';
import { recallStateEvidence } from '../apps/agent/src/memory/recall.ts';
import { describeHistoryCompatibility } from '../apps/agent/src/memory/history-compatibility.ts';
import { buildInterviewContext } from '../apps/agent/src/context/build-context.ts';
import { buildInterviewReport } from '../apps/agent/src/reporting/build-report.ts';
import { InterviewStateSchema } from '../packages/contracts/src/interview-state.ts';
const now=1000000,skill='spring-transactions';
export const policy={id:'compat-1',mode:'strict' as const,allowed:[{skillId:skill,rubricId:'r',rubricVersion:'2'}]};
export function scenario(){
 const state=createInterviewState({sessionId:'new',roleId:'java-backend',durationMinutes:20,skills:[{skillId:skill,relevance:1}],historyCompatibility:policy},now);
 state.priorEvidence=[{sessionId:'old',observationId:'o1',roleId:'java-backend',skillId:skill,questionId:'q-old',questionType:'technical',difficulty:1,score:1,quality:1,observedAt:now-3000,rubricId:'r',rubricVersion:'1',evidenceMode:'offline-fixture'},
 {sessionId:'old',observationId:'o2',roleId:'java-backend',skillId:skill,questionId:'q-new',questionType:'technical',difficulty:1,score:.2,quality:1,observedAt:now-2000,rubricId:'r',rubricVersion:'2',evidenceMode:'offline-fixture'}];
 return state;
}
test('strict compatibility gates mastery and prompt history but retains original scores, provenance and asked IDs',()=>{
 const state=scenario(),before=JSON.stringify(state),est=estimateSkills(state,now)[0]!;
 expect(est.mastery).toBe(.2);expect(est.independentQuestions).toBe(1);
 const recall=recallStateEvidence(state,now);expect(recall.selected.map(e=>e.questionId)).toEqual(['q-new']);
 expect(recall.askedQuestionIds).toEqual(['q-new','q-old']);expect(recall.excluded[0]!.reason).toBe('rubric_incompatible');
 const audit=describeHistoryCompatibility(state);expect(audit.mode).toBe('strict');expect(audit.eligibleCount).toBe(1);expect(audit.excludedCount).toBe(1);
 const ctx=buildInterviewContext({state,now,goal:'练习',phase:'questioning',answer:'',knowledge:[]});
 expect(JSON.parse(ctx.userPrompt).memory.map((e:{rubricVersion:string})=>e.rubricVersion)).toEqual(['2']);
 expect(ctx.audit.memory.reasonCounts.rubric_incompatible).toBe(1);expect(JSON.stringify(state)).toBe(before);
});
test('strict empty list gives unknown mastery; a later repeat cannot promote an incompatible first anchor',()=>{
 const state=scenario();state.historyCompatibility={id:'none',mode:'strict',allowed:[]};
 expect(estimateSkills(state,now)[0]!.mastery).toBeNull();expect(estimateSkills(state,now)[0]!.confidence).toBe(0);
 state.historyCompatibility=policy;
 state.priorEvidence[1]!.questionId='q-old';
 expect(estimateSkills(state,now)[0]!.independentQuestions).toBe(0);expect(recallStateEvidence(state,now).selected).toEqual([]);
 const repeated=recordObservation(state,{observationId:'repeat',roleId:'java-backend',skillId:skill,questionId:'q-old',questionType:'technical',difficulty:1,score:1,quality:1,observedAt:now},0,now);
 expect(estimateSkills(repeated,now)[0]!.mastery).toBeNull();
 const fresh=recordObservation(state,{observationId:'fresh',roleId:'java-backend',skillId:skill,questionId:'fresh-q',questionType:'technical',difficulty:1,score:.4,quality:1,observedAt:now},0,now);
 expect(estimateSkills(fresh,now)[0]!.mastery).toBe(.4);
});
test('policy is exact host declaration: unknown skills/duplicate tuples reject, old sessions remain explicitly unchecked',()=>{
 const state=scenario(),bad=structuredClone(state);bad.historyCompatibility!.allowed[0]!.skillId='other';
 expect(InterviewStateSchema.safeParse(bad).success).toBe(false);
 const dup=structuredClone(state);dup.historyCompatibility!.allowed.push(dup.historyCompatibility!.allowed[0]!);expect(InterviewStateSchema.safeParse(dup).success).toBe(false);
 const changed=structuredClone(state);changed.historyCompatibility!.allowed[0]!.rubricId='other';expect(estimateSkills(changed,now)[0]!.mastery).toBeNull();
 const legacy=structuredClone(state);delete legacy.historyCompatibility;
 expect(estimateSkills(legacy,now)[0]!.mastery).toBe(.6);expect(describeHistoryCompatibility(legacy).mode).toBe('legacy-unchecked');
 expect(InterviewStateSchema.parse(JSON.parse(JSON.stringify(legacy))).historyCompatibility).toBeUndefined();
});
test('history-only report shows gating and preserves every original rubric version',async()=>{
 const state=scenario(),report=await buildInterviewReport({state,generatedAt:now,skillLabels:{[skill]:'事务'},turns:[],policyVersion:'p'});
 expect(report.skills[0]!.mastery).toBe(.2);expect(report.skills[0]!.rubricVersions).toHaveLength(2);
 expect(report.warnings).toContain('history_rubric_compatibility_host_declared');expect(report.warnings).toContain('incompatible_history_excluded_from_estimates');
});
test('equal-time histories use the same canonical first anchor for estimates and recall regardless of input order',()=>{
 for(const sameSession of [false,true]){
  const state=scenario(),allowed={...state.priorEvidence[1]!,sessionId:sameSession?'old':'z',observationId:'z',questionId:'same-q',observedAt:now-1000};
  const denied={...state.priorEvidence[0]!,sessionId:sameSession?'old':'a',observationId:'a',questionId:'same-q',observedAt:now-1000};
  for(const order of [[allowed,denied],[denied,allowed]]){
   state.priorEvidence=order;expect(InterviewStateSchema.safeParse(state).success).toBe(true);
   expect(estimateSkills(state,now)[0]!.mastery).toBeNull();
   expect(recallStateEvidence(state,now).selected).toEqual([]);
   const context=buildInterviewContext({state,now,goal:'同时间排序边界',phase:'questioning',answer:'',knowledge:[]});
   expect(JSON.parse(context.userPrompt).memory).toEqual([]);
  }
 }
 const legacy=scenario();delete legacy.historyCompatibility;
 legacy.priorEvidence=[{...legacy.priorEvidence[1]!,observationId:'z',questionId:'same-q',observedAt:now-1000},
  {...legacy.priorEvidence[0]!,observationId:'a',questionId:'same-q',observedAt:now-1000}];
 expect(estimateSkills(legacy,now)[0]!.mastery).toBe(.2);
 expect(recallStateEvidence(legacy,now).selected[0]!.observationId).toBe('z');
 expect(describeHistoryCompatibility(legacy).mode).toBe('legacy-unchecked');
});
