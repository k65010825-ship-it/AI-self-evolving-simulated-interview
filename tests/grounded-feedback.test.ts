import { test,expect } from 'bun:test';
import { runContentRubricsDemo } from '../scripts/demo-content-rubrics.ts';
import { ContentReportSchema } from '../packages/contracts/src/report.ts';
import { buildInterviewReport } from '../apps/agent/src/reporting/build-report.ts';
import { createScoringExecutor } from '../apps/agent/src/tools/scoring-executor.ts';
import { createMemory,appendMemory,startSessionFromMemory } from '../apps/agent/src/memory/session-memory.ts';
import { buildCriterionFeedback } from '../packages/interview-domain/src/feedback.ts';
test('both role reports derive criterion feedback linked to exact rubric and revalidated excerpts',async()=>{
 for(const role of ['java-backend','web-frontend']as const){const d=await runContentRubricsDemo(role),r=d.report;
  const a=r.assessments[0]!,cards=a.criterionFeedback!;expect(cards).toHaveLength(a.rubric.criteria.length);expect(a.feedbackVerification).toBe('not_verified');
  for(const card of cards){const criterion=a.rubric.criteria.find(c=>c.id===card.criterionId)!;
   expect(card.answerId).toBe(a.answerId);expect(card.rubricVersion).toBe(a.rubricVersion);
   expect(card.evidenceIds.every(id=>a.evidence.some(e=>e.id===id))).toBe(true);
   expect(card.semanticSupport).toBe('not_verified');
   expect(card.nextAnchor?.score??null).toBe(criterion.anchors?.find(x=>x.score>(card.score??criterion.maxScore))?.score??null);
  }
  expect(r.studyPlan.flatMap(p=>p.feedbackRefs??[]).length).toBeGreaterThan(0);
  expect(r.studyPlan.flatMap(p=>p.actions)).not.toContain('需要人工参考集核验维度语义和引文支持关系');
  expect(d.liveModelCalls).toBe(0);
 }
},30000);
test('report schema refuses broken feedback references and actions do not become diagnoses of missing phrases',async()=>{
 const d=await runContentRubricsDemo();const tampered=structuredClone(d.report);
 tampered.assessments[0]!.criterionFeedback![0]!.evidenceIds[0]='forged-evidence';
 expect(ContentReportSchema.safeParse(tampered).success).toBe(false);
 const refs=structuredClone(d.report);refs.studyPlan[0]!.feedbackRefs![0]!.criterionId='unknown';
 expect(ContentReportSchema.safeParse(refs).success).toBe(false);
 const forged=structuredClone(d.reportInput);forged.turns[0]!.proposal.evidence[0]!.excerpt='不是原文';
 await expect(buildInterviewReport(forged)).rejects.toThrow('VALIDATION_ERROR');
 const duplicate=structuredClone(d.report);duplicate.assessments.push(structuredClone(duplicate.assessments[0]!));
 expect(ContentReportSchema.safeParse(duplicate).success).toBe(false);
});
test('duplicate evidence IDs cannot ambiguously select between two valid excerpts',()=>{
 expect(()=>createScoringExecutor({userId:'u',roleId:'java-backend',runId:'r',attemptId:'a',deadlineAt:1000,answerId:'answer',answerText:'事务边界',
  evidence:[{id:'same',start:0,end:2,excerpt:'事务'},{id:'same',start:2,end:4,excerpt:'边界'}]},
  [{id:'r',version:'1',roleId:'java-backend',scope:'technical-content',criteria:[{id:'c',maxScore:4,weight:1,required:true}]}])).toThrow('VALIDATION_ERROR');
});
test('study actions prioritize weighted gaps and remain linked when model advice is changed',async()=>{
 const d=await runContentRubricsDemo(),raw=structuredClone(d.reportInput);
 raw.turns.forEach(t=>{t.proposal.feedback.improvements=['未经证据支持的诊断：你完全不会这个岗位'];});
 const r=await buildInterviewReport(raw);
 expect(r.studyPlan.flatMap(p=>p.actions).join()).not.toContain('完全不会');
 for(const p of r.studyPlan){const cards=(p.feedbackRefs??[]).map(ref=>r.assessments.find(a=>a.answerId===ref.answerId)!.criterionFeedback!.find(c=>c.criterionId===ref.criterionId)!);
  expect(cards.map(c=>c.priority)).toEqual(cards.map(c=>c.priority).sort((a,b)=>b-a));
  expect(p.actions).toEqual(cards.length?cards.map(c=>c.action):p.actions);
 }
 const changed=structuredClone(r);changed.studyPlan[0]!.actions[0]='捏造的练习建议';
 expect(ContentReportSchema.safeParse(changed).success).toBe(false);
});
test('historical-only skills keep old questions excluded without inventing current answer citations',async()=>{
 const d=await runContentRubricsDemo(),identity={userId:'fixture-user',roleId:d.roleId},now=d.report.generatedAt+1;
 const memory=await appendMemory(createMemory(identity,now),{...identity,expectedVersion:0,sessionStatus:'completed',now,reportInput:d.reportInput});
 const state=startSessionFromMemory(memory,{...identity,now:now+1,session:{sessionId:'history-only',roleId:d.roleId,durationMinutes:20,skills:d.reportInput.state.skills}});
 const r=await buildInterviewReport({state,generatedAt:now+1,policyVersion:'next',skillLabels:d.reportInput.skillLabels,turns:[]});
 expect(r.assessments).toHaveLength(0);expect(r.studyPlan.length).toBeGreaterThan(0);
 for(const p of r.studyPlan){expect(p.feedbackRefs).toEqual([]);expect(p.evidenceAnswerIds).toEqual([]);
  const previous=d.report.assessments.find(a=>a.skillId===p.skillId);if(previous)expect(p.retest.excludeQuestionIds).toContain(previous.questionId);
 }
});
test('shared projection returns independent evidence and anchor data',async()=>{
 const d=await runContentRubricsDemo(),a=d.report.assessments[0]!,before=JSON.stringify(a);
 const cards=buildCriterionFeedback(a),gap=cards.find(c=>c.nextAnchor)!;
 gap.evidenceIds.push('external');gap.nextAnchor!.description='外部编辑';
 expect(JSON.stringify(a)).toBe(before);
});
