import{test,expect}from'bun:test';
import{runContentRubricsDemo}from'../scripts/demo-content-rubrics.ts';
import{buildInterviewReport}from'../apps/agent/src/reporting/build-report.ts';
import{decideNextAction}from'../apps/agent/src/planning/interview-state.ts';
import{validateWorkflowTransition}from'../packages/agent-client/src/commit-validation.ts';
import{finishCommitFixture}from'./helpers/finish-commit-fixture.ts';
import{createScoringExecutor}from'../apps/agent/src/tools/scoring-executor.ts';
test('strict report replay refuses arithmetic-valid zero grades whose only evidence is no-answer',async()=>{
 const f=await runContentRubricsDemo(),raw=structuredClone(f.reportInput),turn=raw.turns[0]!;
 raw.turns=[turn];turn.input.answer.text='不知道';turn.proposal.evidence=[{id:'e',start:0,end:3,excerpt:'不知道'}];
 const p=turn.proposal,score=p.evaluation;score.normalizedScore=0;score.coverageWeight=1;score.complete=true;score.missingDimensions=[];
 for(const d of score.dimensions){d.score=0;d.normalizedScore=0;d.evidenceIds=['e'];}
 p.nextState.observations[0]!.score=0;const at=p.nextState.observations[0]!.observedAt;
 p.nextAction=decideNextAction(p.nextState,at,turn.input.planningPolicy?.parameters??{});raw.state=structuredClone(p.nextState);
 const before=JSON.stringify(raw);await expect(buildInterviewReport(raw)).rejects.toThrow('VALIDATION_ERROR');expect(JSON.stringify(raw)).toBe(before);
});
test('restore cannot carry an existing unsafe graded turn across the host commit boundary',async()=>{
 const f=await finishCommitFixture();try{const safe=f.store.current().session!.workflow;
 expect(()=>validateWorkflowTransition({action:'restore',snapshot:safe},safe,Date.now())).not.toThrow();
 const forged=structuredClone(safe),t=forged.turns[0]!;t.input.answer.text='不知道';t.proposal.evidence=[{id:'e',start:0,end:3,excerpt:'不知道'}];
 for(const d of t.proposal.evaluation.dimensions)d.evidenceIds=['e'];
 expect(()=>validateWorkflowTransition({action:'restore',snapshot:forged},forged,Date.now())).toThrow('COMMIT_TRANSITION_INVALID');
 }finally{f.runtime.dispose();}
});
test('syntactic references remain mandatory even when the quote would otherwise cause abstention',async()=>{
 const execute=createScoringExecutor({userId:'u',roleId:'java-backend',runId:'r',attemptId:'a',deadlineAt:1000,answerId:'a',answerText:'不知道',evidence:[{id:'e',start:0,end:3,excerpt:'不知道'}]},
 [{id:'r',version:'1',roleId:'java-backend',scope:'technical-content',criteria:[{id:'c',maxScore:4,weight:1,required:true}]}],{allowRequiredAbstention:true});
 const r=await execute('call',{rubricId:'r',rubricVersion:'1',criterionScores:[{criterionId:'c',score:4,evidenceIds:['forged']}]},undefined,()=>1);
 expect(r.status).toBe('error');expect(r.data).toBeUndefined();
});
