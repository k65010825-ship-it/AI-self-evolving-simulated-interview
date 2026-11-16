import {test,expect} from 'bun:test';
import {createInterviewWorkflow,planInterviewQuestion,submitInterviewAnswer,finishInterviewWorkflow,restoreInterviewWorkflow} from '../apps/agent/src/orchestration/session-workflow.ts';
import {createWorkflowFixture} from '../experiments/session/fixture.ts';
import {validateWorkflowTransition} from '../packages/agent-client/src/commit-validation.ts';
import {selectNextQuestion} from '../apps/agent/src/planning/select-question.ts';
import {createHash} from 'node:crypto';
import {makeSpeechFixture} from '../experiments/speech/fixture.ts';
import {transcribeSpeech} from '../apps/agent/src/speech/transcribe.ts';
import {confirmSpeechAnswer} from '../apps/agent/src/speech/confirm.ts';
const at=Date.now();
async function setup(){const identity={userId:'clarification-user',roleId:'java-backend' as const};
 const initial=createInterviewWorkflow({identity,session:{sessionId:'clarification-session',roleId:identity.roleId,durationMinutes:20,skills:[{skillId:'project-design',relevance:1}]},
 policy:{id:'p',roleId:identity.roleId,parameters:{maxFollowupDepth:0,maxTurns:2,wrapUpSeconds:30}},goal:'练习',skillLabels:{'project-design':'项目设计'},allowDraftKnowledge:true,now:at});
 const fixture=await createWorkflowFixture();const context={...identity,runId:'plan',attemptId:'attempt',deadlineAt:at+60000};
 const planned=await planInterviewQuestion(initial,{identity,expectedRevision:0,context},{...fixture,now:()=>at});
 return {planned,fixture,identity,context};}
const insufficient=async(request:any)=>({evidence:[],criterionScores:request.rubric.criteria.map((c:any)=>({criterionId:c.id,score:null,evidenceIds:[]})),feedback:{strengths:[],improvements:['需要更多证据']}});
function command(s:any,context:any,n:number,text='我的原始回答'){return {identity:s.identity,expectedRevision:s.revision,context:{...context,runId:`answer-${n}`},observationId:'observation',answer:{id:`answer-${n}`,text},quality:1,evidenceMode:'offline-fixture' as const};}
test('workflow clarification survives restart, appends original text, commits one observation and rejects rewrites',async()=>{
 const {planned,fixture,context}=await setup();const first=await submitInterviewAnswer(planned,command(planned,context,1),{evaluate:insufficient,now:()=>at});
 expect(first.phase).toBe('awaiting_answer');expect(first.state.version).toBe(0);expect(first.turns).toHaveLength(0);expect(first.clarificationAttempts).toHaveLength(1);
 validateWorkflowTransition({action:'answer',snapshot:planned,command:command(planned,context,1)},first,at);
 const restored=await restoreInterviewWorkflow(JSON.stringify(first),first.identity);expect(restored).toEqual(first);
 await expect(submitInterviewAnswer(restored,command(restored,context,2,'替换了原回答'),{...fixture,now:()=>at+1})).rejects.toThrow('VERSION_CONFLICT');
 const c=command(restored,context,2,'我的原始回答\n补充：我先界定业务约束与失败恢复');
 const scored=await submitInterviewAnswer(restored,c,{...fixture,now:()=>at+1});expect(scored.state.observations).toHaveLength(1);expect(scored.state.version).toBe(1);
 validateWorkflowTransition({action:'answer',snapshot:restored,command:c},scored,at+1);
 const end=await finishInterviewWorkflow(scored,{identity:scored.identity,expectedRevision:scored.revision,mode:'user_stop',sourceGroupId:'g'},{now:()=>at+2});
 expect(end.closeout!.report.coverage.totalAnswers).toBe(1);expect(end.closeout!.memoryCandidate.sessions[0]!.observations).toHaveLength(1);
 expect(await restoreInterviewWorkflow(JSON.stringify(end),end.identity)).toEqual(end);
});
test('exhausted clarification abstains without score or memory and next question still works',async()=>{
 const {planned,fixture,context}=await setup();const first=await submitInterviewAnswer(planned,command(planned,context,1),{evaluate:insufficient,now:()=>at});
 const c=command(first,context,2,'我的原始回答\n仍然不确定');const abstained=await submitInterviewAnswer(first,c,{evaluate:insufficient,now:()=>at+1});
 expect(abstained.phase).toBe('ready_to_plan');expect(abstained.state.version).toBe(0);expect(abstained.turns).toHaveLength(0);
 validateWorkflowTransition({action:'answer',snapshot:first,command:c},abstained,at+1);
 const next=await planInterviewQuestion(abstained,{identity:abstained.identity,expectedRevision:abstained.revision,context:{...context,runId:'next-plan'}},{...fixture,now:()=>at+2,
  plan:async input=>{const receipt=structuredClone(planned.lastPlan!.receipts[0]!);receipt.data!.items=receipt.data!.items.map(i=>({...i,id:'different-question'}));
   return {kind:'uncommitted-knowledge-plan',receipts:[receipt],modelMessages:0,selection:selectNextQuestion({state:input.state,askedQuestionIds:input.askedQuestionIds,planningPolicy:input.planningPolicy,now:at+2,knowledge:receipt.data!.items},{allowDraftKnowledge:true})};}});
 expect(next.phase).toBe('awaiting_answer');expect(next.current!.question.id).not.toBe(planned.current!.question.id);
 const finish={identity:next.identity,expectedRevision:next.revision,mode:'user_stop' as const,sourceGroupId:'g'};
 const end=await finishInterviewWorkflow(next,finish,{now:()=>at+3});expect(end.closeout!.report.coverage.totalAnswers).toBe(1);expect(end.closeout!.report.coverage.scoredAnswers).toBe(0);
 expect(end.closeout!.report.unscoredAnswers![0]!.normalizedScore).toBeNull();expect(end.closeout!.memoryCandidate.version).toBe(0);
 validateWorkflowTransition({action:'finish',snapshot:next,command:finish},end,at+3);
 expect(await restoreInterviewWorkflow(JSON.stringify(end),end.identity)).toEqual(end);
 const scoredCommand={...command(next,context,3,'第二个题目的充分回答'),observationId:'observation-2'};
 const scored=await submitInterviewAnswer(next,scoredCommand,{...fixture,now:()=>at+3});expect(scored.state.observations).toHaveLength(1);
 validateWorkflowTransition({action:'answer',snapshot:next,command:scoredCommand},scored,at+3);
 const mixedFinish={...finish,expectedRevision:scored.revision};const mixed=await finishInterviewWorkflow(scored,mixedFinish,{now:()=>at+4});
 expect(mixed.closeout!.report.coverage.totalAnswers).toBe(2);expect(mixed.closeout!.report.coverage.scoredAnswers).toBe(1);
 expect(mixed.closeout!.memoryCandidate.sessions[0]!.observations).toHaveLength(1);expect(mixed.closeout!.report.unscoredAnswers).toHaveLength(1);
 validateWorkflowTransition({action:'finish',snapshot:scored,command:mixedFinish},mixed,at+4);
 expect(await restoreInterviewWorkflow(JSON.stringify(mixed),mixed.identity)).toEqual(mixed);
});
test('stopping during pending clarification reports evidence gap and tampered receipts cannot restore',async()=>{
 const {planned,context}=await setup();const first=await submitInterviewAnswer(planned,command(planned,context,1),{evaluate:insufficient,now:()=>at});
 const corrupted=structuredClone(first);corrupted.clarificationAttempts![0]!.resolution.answerDigest='0'.repeat(64);
 await expect(restoreInterviewWorkflow(JSON.stringify(corrupted),first.identity)).rejects.toThrow('VALIDATION_ERROR');
 const ended=await finishInterviewWorkflow(first,{identity:first.identity,expectedRevision:first.revision,mode:'user_stop',sourceGroupId:'stop'},{now:()=>at+1});
 expect(ended.closeout!.report.coverage.unscoredAnswers).toBe(1);expect(ended.closeout!.report.assessments).toHaveLength(0);expect(ended.closeout!.memoryDisposition).toBe('unchanged_no_answers');
});


test('short remaining session time abstains and automatic closeout reports an ungraded answer honestly',async()=>{
 const {planned,context}=await setup();const late=at+1170000;
 const c={...command(planned,context,1),context:{...context,runId:'late-answer',deadlineAt:late+10000}};
 const abstained=await submitInterviewAnswer(planned,c,{evaluate:insufficient,now:()=>late});
 expect(abstained.phase).toBe('ready_to_close');expect(abstained.clarificationAttempts![0]!.resolution.reason).toBe('time_budget');
 expect(abstained.state.observations).toHaveLength(0);validateWorkflowTransition({action:'answer',snapshot:planned,command:c},abstained,late);
 const end=await finishInterviewWorkflow(abstained,{identity:abstained.identity,expectedRevision:abstained.revision,mode:'automatic',sourceGroupId:'late'},{now:()=>late+1});
 expect(end.closeout!.report.skills[0]!.mastery).toBeNull();expect(end.closeout!.report.coverage.totalAnswers).toBe(1);
 expect(end.closeout!.report.unscoredAnswers![0]!.reason).toBe('time_budget');expect(end.closeout!.memoryCandidate.version).toBe(0);
});
test('commit rejects answer-leading clarification even when its receipt hash has been recomputed',async()=>{
 const {planned,context}=await setup(),c=command(planned,context,1);
 const first=await submitInterviewAnswer(planned,c,{evaluate:insufficient,now:()=>at});
 const forged=structuredClone(first),r=forged.clarificationAttempts![0]!.resolution;
 r.clarification='The correct answer is supplied here. Copy it.';
 const {digest,...body}=r;r.digest=createHash('sha256').update(JSON.stringify(body)).digest('hex');
 expect(()=>validateWorkflowTransition({action:'answer',snapshot:planned,command:c},forged,at)).toThrow('COMMIT_TRANSITION_INVALID');
});
test('retest excludes a question already answered without enough grading evidence',async()=>{
 const {planned,context}=await setup();const first=await submitInterviewAnswer(planned,command(planned,context,1),{evaluate:insufficient,now:()=>at});
 const end=await finishInterviewWorkflow(first,{identity:first.identity,expectedRevision:first.revision,mode:'user_stop',sourceGroupId:'exclude'},{now:()=>at+1});
 expect(end.closeout!.report.studyPlan[0]!.retest.excludeQuestionIds).toContain(planned.current!.question.id);
});
async function pendingSpeech(){const {planned,context}=await setup(),audio=makeSpeechFixture();
 const transcript=await transcribeSpeech({...audio.input,context},{provider:audio.provider,now:()=>at});
 const speech=confirmSpeechAnswer(transcript,{transcriptionId:transcript.transcriptionId,audioSha256:transcript.audio.sha256,
  userId:planned.identity.userId,roleId:planned.identity.roleId,answerId:'speech-answer',text:transcript.originalText,confirmedAt:at});
 const c={...command(planned,context,1),answer:speech.answer,speech};
 return {planned,c,first:await submitInterviewAnswer(planned,c,{evaluate:insufficient,now:()=>at})};
}
test('unscored confirmed audio retains timing descriptions and full answer coverage without mastery scores',async()=>{
 const {first}=await pendingSpeech();const c={identity:first.identity,expectedRevision:first.revision,mode:'user_stop' as const,sourceGroupId:'speech'};
 const end=await finishInterviewWorkflow(first,c,{now:()=>at+1}),expression=end.closeout!.report.expression;
 expect(expression.status).toBe('audio_descriptions');if(expression.status!=='audio_descriptions')throw Error('missing audio');
 expect(expression.coverage).toEqual({totalAnswers:1,speechAnswers:1,textAnswers:0,descriptiveAnswers:1,insufficientAnswers:0});
 expect(expression.answers[0]!.answerId).toBe('speech-answer');expect(end.closeout!.report.assessments).toHaveLength(0);
 validateWorkflowTransition({action:'finish',snapshot:first,command:c},end,at+1);
 expect(await restoreInterviewWorkflow(JSON.stringify(end),end.identity)).toEqual(end);
});
test('restoring unscored audio revalidates owner and confirmed text independently of receipt digest',async()=>{
 const {first}=await pendingSpeech();const badOwner=structuredClone(first);badOwner.clarificationAttempts![0]!.input.speech!.transcription.userId='another-user';
 await expect(restoreInterviewWorkflow(JSON.stringify(badOwner),first.identity)).rejects.toThrow('FORBIDDEN');
 const badAnswer=structuredClone(first);badAnswer.clarificationAttempts![0]!.input.speech!.answer.text='changed confirmation';
 await expect(restoreInterviewWorkflow(JSON.stringify(badAnswer),first.identity)).rejects.toThrow('VERSION_CONFLICT');
});
