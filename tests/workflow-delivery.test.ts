import{test,expect}from'bun:test';
import{createWorkflowFixture}from'../experiments/session/fixture.ts';
import{createInterviewWorkflow,planInterviewQuestion,submitInterviewAnswer,finishInterviewWorkflow,restoreInterviewWorkflow}from'../apps/agent/src/orchestration/session-workflow.ts';
import{runSessionWorkflowDemo}from'../scripts/demo-session-workflow.ts';
import{WorkflowSchema}from'../packages/contracts/src/session-workflow.ts';
import {projectFeedbackPublication} from '../packages/interview-domain/src/feedback-publication.ts';
test('workflow retains actual issued text through scoring, report and JSON restoration without rewriting the rubric',async()=>{
 const now=Date.now(),identity={userId:'workflow-delivery',roleId:'java-backend' as const},f=await createWorkflowFixture();
 let s=createInterviewWorkflow({identity,session:{sessionId:'workflow-delivery',roleId:identity.roleId,durationMinutes:20,
  skills:[{skillId:'spring-transactions',relevance:1},{skillId:'java-concurrency',relevance:.99}]},policy:{id:'pin',roleId:identity.roleId,
  parameters:{maxFollowupDepth:0,maxTurns:2,wrapUpSeconds:30}},goal:'呈现留存',skillLabels:{'spring-transactions':'事务','java-concurrency':'并发'},allowDraftKnowledge:true,now});
 let generated=0;const deliver=async()=>{generated++;return{bridge:'你刚才提到“事务边界”，我们换个方向继续。',excerpt:'事务边界'};};
 const context=(id:string)=>({...identity,runId:id,attemptId:'a',deadlineAt:Date.now()+60000});
 s=await planInterviewQuestion(s,{identity,expectedRevision:s.revision,context:context('p0')},{plan:f.plan,deliver});
 expect(generated).toBe(0);expect(s.issuedQuestions[0]).toHaveProperty('content.text',s.current!.question.text);
 s=await submitInterviewAnswer(s,{identity,expectedRevision:s.revision,context:context('a0'),observationId:'o0',answer:{id:'answer0',text:'事务边界需要幂等恢复。'},quality:1,evidenceMode:'offline-fixture'},f);
 s=await planInterviewQuestion(s,{identity,expectedRevision:s.revision,context:context('p1')},{plan:f.plan,deliver});
 expect(generated).toBe(1);const issued=s.issuedQuestions[1]!;expect(issued).toHaveProperty('content.delivery.status','generated');
 expect(issued).toHaveProperty('content.text','你刚才提到“事务边界”，我们换个方向继续。\n'+s.current!.question.text);
 const canonical=s.current!.question,rubric=s.current!.rubric;
 s=await submitInterviewAnswer(s,{identity,expectedRevision:s.revision,context:context('a1'),observationId:'o1',answer:{id:'answer1',text:'可见性不同于原子性。'},quality:1,evidenceMode:'offline-fixture'},f);
 expect(s.turns[1]!.input).toHaveProperty('presentedText',issued.content!.text);expect(s.turns[1]!.input.question).toEqual(canonical);expect(s.turns[1]!.input.rubric).toEqual(rubric);
 s=await finishInterviewWorkflow(s,{identity,expectedRevision:s.revision,sourceGroupId:'group'});
 expect(s.closeout!.report.assessments[1]).toHaveProperty('presentedText',issued.content!.text);
 expect(s.closeout!.report.assessments[1]).toHaveProperty('presentationReview','pending');
 expect(await restoreInterviewWorkflow(JSON.stringify(s),identity)).toEqual(s);
});
test('restore rejects altered issued text, rubric and answer presentation, while legacy records remain explicitly unknown',async()=>{
 const d=await runSessionWorkflowDemo(),s=d.session;
 for(const edit of [(bad:typeof s)=>{bad.issuedQuestions[0]!.content!.text='改过的原题';},
  (bad:typeof s)=>{bad.issuedQuestions[0]!.content!.rubric.version='other';},
  (bad:typeof s)=>{bad.turns[0]!.input.presentedText='额外提示\n'+bad.turns[0]!.input.question.text;}]){
  const bad=structuredClone(s);edit(bad);expect(WorkflowSchema.safeParse(bad).success).toBe(false);
  await expect(restoreInterviewWorkflow(JSON.stringify(bad),s.identity)).rejects.toThrow('VALIDATION_ERROR');
 }
 const legacy=structuredClone(s);for(const q of legacy.issuedQuestions)delete q.content;
 for(const t of legacy.turns)delete t.input.presentedText;
 for(const a of legacy.closeout!.report.assessments){delete a.presentedText;delete a.presentationReview;}
 // Removing presentation changes the complete source snapshot: its old publication
 // binding must fail. A genuine unknown-presentation input gets a fresh projection.
 await expect(restoreInterviewWorkflow(JSON.stringify(legacy),legacy.identity)).rejects.toThrow('VALIDATION_ERROR');
 for(const a of legacy.closeout!.report.assessments){
  const t=legacy.turns.find(t=>t.input.answer.id===a.answerId)!;
  const publication=projectFeedbackPublication(t.input,t.proposal);
  a.feedback=publication.feedback;a.feedbackPublication=publication.publication;
 }
 expect(await restoreInterviewWorkflow(JSON.stringify(legacy),legacy.identity)).toEqual(legacy);
});
test('cancelling workflow presentation leaves the original issued log and revision unchanged',async()=>{
 const now=Date.now(),identity={userId:'cancel-delivery',roleId:'java-backend' as const},f=await createWorkflowFixture();
 let s=createInterviewWorkflow({identity,session:{sessionId:'cancel-delivery',roleId:identity.roleId,durationMinutes:20,
  skills:[{skillId:'spring-transactions',relevance:1},{skillId:'java-concurrency',relevance:.99}]},policy:{id:'pin',roleId:identity.roleId,
  parameters:{maxFollowupDepth:0,maxTurns:2,wrapUpSeconds:30}},goal:'取消',skillLabels:{'spring-transactions':'事务','java-concurrency':'并发'},allowDraftKnowledge:true,now});
 const context=(id:string)=>({...identity,runId:id,attemptId:'a',deadlineAt:Date.now()+60000});
 s=await planInterviewQuestion(s,{identity,expectedRevision:0,context:context('cp0')},f);
 s=await submitInterviewAnswer(s,{identity,expectedRevision:s.revision,context:context('ca0'),observationId:'o0',answer:{id:'a0',text:'事务边界和缓存重试。'},quality:1,evidenceMode:'offline-fixture'},f);
 const before=structuredClone(s),controller=new AbortController();let entered!:()=>void,release!:(v:unknown)=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const work=planInterviewQuestion(s,{identity,expectedRevision:s.revision,context:context('cp1')},{plan:f.plan,signal:controller.signal,deliver:async()=>{
  entered();return new Promise(resolve=>{release=resolve;});}});
 await started;controller.abort();await expect(work).rejects.toThrow('RUN_CANCELLED');release({bridge:'你提到事务边界。',excerpt:'事务边界'});
 await new Promise(resolve=>setTimeout(resolve,1));expect(s).toEqual(before);
});
