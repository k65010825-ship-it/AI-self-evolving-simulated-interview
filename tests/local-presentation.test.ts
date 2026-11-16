import {beforeAll,test,expect} from 'bun:test';
import {createInterviewWorkflow,planInterviewQuestion,submitInterviewAnswer,finishInterviewWorkflow} from '../apps/agent/src/orchestration/session-workflow.ts';
import {createWorkflowFixture} from '../experiments/session/fixture.ts';
import {localSessionPresentation,localAnswerPage,localReport} from '../apps/agent/src/local/presentation.ts';
import {LocalAnswerPageSchema,LocalReportViewSchema} from '../packages/contracts/src/local-presentation.ts';
import type {InterviewWorkflow} from '../packages/contracts/src/session-workflow.ts';
const at=Date.now();let planned:InterviewWorkflow,scored:InterviewWorkflow,clarified:InterviewWorkflow,abstained:InterviewWorkflow,closed:InterviewWorkflow;
const insufficient=async(request:any)=>({evidence:[],criterionScores:request.rubric.criteria.map((c:any)=>({criterionId:c.id,score:null,evidenceIds:[]})),feedback:{strengths:[],improvements:['need evidence']}});
function answer(w:InterviewWorkflow,id:string,text:string){return{identity:w.identity,expectedRevision:w.revision,context:{...w.identity,runId:'run-'+id,attemptId:'attempt',deadlineAt:at+60000},observationId:'obs-current',answer:{id,text},quality:1,evidenceMode:'offline-fixture' as const};}
beforeAll(async()=>{
 const identity={userId:'view-user',roleId:'java-backend' as const};const fixture=await createWorkflowFixture();
 const w=createInterviewWorkflow({identity,session:{sessionId:'view-session',roleId:identity.roleId,durationMinutes:20,skills:[{skillId:'project-design',relevance:1}]},policy:{id:'policy',roleId:identity.roleId,parameters:{maxFollowupDepth:0,maxTurns:2,wrapUpSeconds:30}},goal:'test',skillLabels:{'project-design':'项目设计'},allowDraftKnowledge:true,now:at});
 planned=await planInterviewQuestion(w,{identity,expectedRevision:0,context:{...identity,runId:'plan',attemptId:'attempt',deadlineAt:at+60000}},{...fixture,now:()=>at});
 scored=await submitInterviewAnswer(planned,answer(planned,'scored','😀我先明确项目边界，再说明失败验证。'),{...fixture,now:()=>at+1});
 clarified=await submitInterviewAnswer(planned,answer(planned,'clarify','原回答'),{evaluate:insufficient,now:()=>at+1});
 abstained=await submitInterviewAnswer(clarified,answer(clarified,'abstain','原回答\n仍不确定'),{evaluate:insufficient,now:()=>at+2});
 closed=await finishInterviewWorkflow(scored,{identity,expectedRevision:scored.revision,mode:'user_stop',sourceGroupId:'view-group'},{now:()=>at+2});
});
test('clarification has a neutral prompt and original prefix; unique submitted questions are counted once',()=>{
 const v=localSessionPresentation(clarified);expect(v.clarification).toMatchObject({previousText:'原回答'});expect(v.clarification!.prompt.length).toBeGreaterThan(0);expect(v).toMatchObject({submittedCount:1,scoredCount:0,unscoredCount:1});
 expect(v.lastAnswer).toMatchObject({status:'needs_clarification',normalizedScore:null,criteria:[]});
 expect(localSessionPresentation(scored).clarification).toBeNull();
});
test('abstention is not zero and duplicate clarification attempts do not inflate answer counts',()=>{
 const p=localAnswerPage(abstained,{offset:0,limit:5});expect(p.total).toBe(1);expect(p.items[0]).toMatchObject({status:'abstained',normalizedScore:null,evidence:[],strengths:[],improvements:[]});
 expect(localSessionPresentation(abstained)).toMatchObject({submittedCount:1,unscoredCount:1});
});
test('scored answer feedback is available before closeout without exposing rubric requirements or tool state',()=>{
 const p=localAnswerPage(scored,{offset:0,limit:5});expect(LocalAnswerPageSchema.safeParse(p).success).toBe(true);expect(p.items[0]).toMatchObject({status:'scored',normalizedScore:0.5});
 const data=JSON.stringify(p);for(const word of ['keyPoints','answerGuide','nextAnchor','evidenceRule','verificationGoal','toolName','baseMemory','receipt','owner'])expect(data).not.toContain('"'+word+'"');
 expect(p.items[0]!.evidence[0]).toMatchObject({answerId:'scored',start:0,end:4,excerpt:'😀我先'});
 for(const c of scored.turns[0]!.input.rubric.criteria)if(c.description)expect(p.items[0]!.criteria.map(v=>v.label)).not.toContain(c.description);
});
test('report evidence uses original offsets and fails closed on a mismatched stored quote',()=>{
 const report=localReport(closed,{offset:0,limit:5})!;expect(LocalReportViewSchema.safeParse(report).success).toBe(true);expect(report.answers[0]!.evidence[0]!.answerId).toBe('scored');
 expect(report).toMatchObject({presentationVersion:1,aggregation:'per-answer-only',answerPage:{offset:0,limit:5,total:1,nextOffset:null}});
 const changed=structuredClone(closed);changed.turns[0]!.proposal.evidence[0]!.excerpt='invented';expect(()=>localAnswerPage(changed,{offset:0,limit:5})).toThrow();
});
test('zero remains numeric, evidence gaps stay null, and excerpt truncation is explicit',()=>{
 const w=structuredClone(scored),t=w.turns[0]!;t.input.answer.text='😀'+'x'.repeat(400);t.proposal.evidence=[{id:'e',start:0,end:t.input.answer.text.length,excerpt:t.input.answer.text}];t.proposal.evaluation.normalizedScore=0;
 for(const d of t.proposal.evaluation.dimensions){d.score=0;d.normalizedScore=0;d.evidenceIds=['e'];}
 const p=localAnswerPage(w,{offset:0,limit:5});expect(p.items[0]!.normalizedScore).toBe(0);expect(p.items[0]!.evidence[0]!.truncated).toBe(true);expect(p.items[0]!.evidence[0]!.excerpt.length).toBeLessThanOrEqual(240);
});
test('read pages validate bounds and revision, and an empty later page is explicit',()=>{
 expect(()=>localAnswerPage(scored,{offset:0,limit:6})).toThrow('VALIDATION_ERROR');expect(()=>localAnswerPage(scored,{offset:-1,limit:1})).toThrow('VALIDATION_ERROR');
 expect(()=>localAnswerPage(scored,{offset:0,limit:1,expectedRevision:scored.revision-1})).toThrow('VERSION_CONFLICT');
 expect(localAnswerPage(scored,{offset:1,limit:1})).toMatchObject({total:1,items:[],nextOffset:null});
 const before=JSON.stringify(closed);localReport(closed,{offset:0,limit:1});localAnswerPage(closed,{offset:0,limit:1});expect(JSON.stringify(closed)).toBe(before);
});


test('withheld feedback is not republished by immediate or report views',()=>{
 const w=structuredClone(closed);w.turns[0]!.proposal.feedback.strengths=['认识竞态并发窗口'];
 const immediate=localAnswerPage(w,{offset:0,limit:5}).items[0]!;const report=localReport(w)!;
 expect(immediate.withheldFeedbackCount).toBe(1);expect(immediate.strengths).toEqual([]);
 expect(report.answers[0]!.strengths).toEqual([]);expect(JSON.stringify(report)).not.toContain('认识竞态并发窗口');
});
test('display pagination bounds large Unicode payloads and reports omitted evidence',()=>{
 // Structural stress fixture only, not a restored 200-turn workflow or model-quality claim.
 const w=structuredClone(closed),original=structuredClone(w.turns[0]!);
 w.turns=Array.from({length:200},(_,n)=>{const t=structuredClone(original),q='q-'+n,a='a-'+n;t.input.question.id=q;t.proposal.basedOn.questionId=q;t.input.answer.id=a;t.proposal.basedOn.answerId=a;t.proposal.evaluation.answerId=a;
  t.input.answer.text='证'.repeat(10000);t.input.question.text='题'.repeat(4000);delete t.input.presentedText;
  t.proposal.evidence=Array.from({length:10},(_,i)=>({id:'e'+i,start:i*300,end:i*300+300,excerpt:'证'.repeat(300)}));
  for(const d of t.proposal.evaluation.dimensions)d.evidenceIds=t.proposal.evidence.map(e=>e.id);
  t.proposal.feedback={strengths:Array(5).fill('强'.repeat(500)),improvements:Array(5).fill('改'.repeat(500))};return t;});
 w.closeout!.report.coverage.totalAnswers=200;w.closeout!.report.coverage.scoredAnswers=200;
 const report=localReport(w,{offset:0,limit:5})!;expect(report.answers).toHaveLength(5);expect(report.answerPage).toMatchObject({total:200,nextOffset:5});
 expect(report.answers[0]!.evidence).toHaveLength(3);expect(report.answers[0]!.evidenceOmitted).toBe(7);
 expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(1024*1024);
 expect(localReport(w,{offset:195,limit:5})!.answerPage.nextOffset).toBeNull();
});

test('report study actions cannot reintroduce hidden rubric or scoring anchors',()=>{
 const w=structuredClone(closed),secret='PRIVATE_RUBRIC_ANCHOR_MARKER';
 w.turns[0]!.input.rubric.criteria[0]!.description=secret;
 w.closeout!.report.studyPlan[0]!.actions=[secret+' and scoring evidence rules'];
 const report=localReport(w)!;expect(JSON.stringify(report)).not.toContain(secret);
 expect(report.studyPlan[0]!.actions.length).toBeGreaterThan(0);
});
