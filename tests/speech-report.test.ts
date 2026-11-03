import { test, expect } from 'bun:test';
import { makeSpeechFixture } from '../experiments/speech/fixture.ts';
import { transcribeSpeech } from '../apps/agent/src/speech/transcribe.ts';
import { confirmSpeechAnswer } from '../apps/agent/src/speech/confirm.ts';
import { evaluateTurn } from '../apps/agent/src/orchestration/evaluate-turn.ts';
import { buildInterviewReport } from '../apps/agent/src/reporting/build-report.ts';
import { runPiInterviewDemo } from '../scripts/demo-pi-interview.ts';
import { describeSpeech } from '../apps/agent/src/speech/audio-features.ts';

async function source(){
 const demo=await runPiInterviewDemo();const first=demo.reportInput.turns[0]!.input;
 const f=makeSpeechFixture();const transcript=await transcribeSpeech({...f.input,context:{...f.input.context,userId:first.context.userId}}, {provider:f.provider});
 const speech=confirmSpeechAnswer(transcript,{transcriptionId:transcript.transcriptionId,audioSha256:transcript.audio.sha256,
  userId:transcript.userId,roleId:transcript.roleId,answerId:first.answer.id,text:'确认后的事务回答',confirmedAt:Date.now()});
 return{demo,input:{...first,answer:{...speech.answer},speech}};
}
const grade=(text:string)=>({evidence:[{id:'e',start:0,end:4,excerpt:text.slice(0,4)}],
 criterionScores:[{criterionId:'correctness',score:1,evidenceIds:['e']}],feedback:{strengths:['已说明'],improvements:['补充边界']}});
const evaluator=(input:Awaited<ReturnType<typeof source>>['input'])=>async()=>({...grade(input.answer.text),
 criterionScores:input.rubric.criteria.map(c=>({criterionId:c.id,score:c.maxScore/2,evidenceIds:['e']}))});

test('confirmed speech text is evaluated while report retains original ASR timing separately',async()=>{
 const {demo,input}=await source();let requestText='';
 const proposal=await evaluateTurn(input,{evaluate:async request=>{
  requestText=JSON.stringify(request);return{...grade(input.answer.text),criterionScores:input.rubric.criteria.map(c=>({criterionId:c.id,score:c.maxScore/2,evidenceIds:['e']}))};}});
 expect(requestText).toContain(input.answer.text);expect(requestText).not.toContain(input.speech.transcription.originalText);
 const report=await buildInterviewReport({...demo.reportInput,state:proposal.nextState,generatedAt:Date.now(),turns:[{input,proposal,evidenceMode:'offline-fixture'}]});
 expect(report.expression.status).toBe('audio_descriptions');
 if(report.expression.status!=='audio_descriptions')throw new Error('Expected audio descriptions');
 expect(report.expression.answers[0]?.originalText).toBe(input.speech.transcription.originalText);
 expect(report.expression.answers[0]?.confirmedText).toBe(input.answer.text);
 expect(report.expression.answers[0]?.features.unitsPerMinute).toBe(120);
 expect(report.expression.coverage.speechAnswers).toBe(1);expect(report.expression.confidence).toBeNull();
});

test('invalid speech binding and edits are rejected before any content model work',async()=>{
 const {input}=await source();let calls=0;
 const check=async(changed:unknown,code:string)=>{await expect(evaluateTurn(changed,{evaluate:async()=>{calls++;return {};}})).rejects.toThrow(code);};
 const owner=structuredClone(input);owner.speech.transcription.userId='other';await check(owner,'FORBIDDEN');
 const role=structuredClone(input);role.speech.transcription.roleId='web-frontend';await check(role,'ROLE_FORBIDDEN');
 const answer=structuredClone(input);answer.answer.text='different';await check(answer,'VERSION_CONFLICT');
 const id=structuredClone(input);id.speech.answer.id='different';await check(id,'VERSION_CONFLICT');
 const top=structuredClone(input);top.speech.expression.unitsPerMinute=999;await check(top,'VALIDATION_ERROR');
 const sourceRate=structuredClone(input);sourceRate.speech.transcription.expression.unitCount=999;await check(sourceRate,'VALIDATION_ERROR');
 const warning=structuredClone(input);warning.speech.warnings=[];await check(warning,'VALIDATION_ERROR');
 const future=structuredClone(input);future.speech.confirmedAt=Date.now()+10000;await check(future,'VALIDATION_ERROR');
 const old=structuredClone(input);old.speech.transcription.startedAt=input.state.startedAt-1;await check(old,'VALIDATION_ERROR');
 expect(calls).toBe(0);
});

test('report replays speech binding at original observation time instead of report generation time',async()=>{
 const {demo,input}=await source(),proposal=await evaluateTurn(input,{evaluate:evaluator(input)});
 const changed=structuredClone(input);changed.speech.confirmedAt=proposal.nextState.observations[0]!.observedAt+1;
 await expect(buildInterviewReport({...demo.reportInput,state:proposal.nextState,generatedAt:Date.now()+10000,
  turns:[{input:changed,proposal,evidenceMode:'offline-fixture'}]})).rejects.toThrow('VALIDATION_ERROR');
});

test('report rejects speech confirmation text replaced after scoring',async()=>{
 const {demo,input}=await source(),proposal=await evaluateTurn(input,{evaluate:evaluator(input)});
 const changed=structuredClone(input);changed.speech.answer.text='替换后的内容';
 await expect(buildInterviewReport({...demo.reportInput,state:proposal.nextState,generatedAt:Date.now(),
  turns:[{input:changed,proposal,evidenceMode:'offline-fixture'}]})).rejects.toThrow('VERSION_CONFLICT');
});

test('data-insufficient speech is retained without numerical rate and pure text keeps legacy branch',async()=>{
 const {demo,input}=await source();
 input.speech.transcription.originalText='嗯';input.speech.transcription.expression=describeSpeech('嗯',input.speech.transcription.expression.audio);
 input.speech.expression=structuredClone(input.speech.transcription.expression);
 const proposal=await evaluateTurn(input,{evaluate:evaluator(input)});
 const report=await buildInterviewReport({...demo.reportInput,state:proposal.nextState,generatedAt:Date.now(),turns:[{input,proposal,evidenceMode:'offline-fixture'}]});
 if(report.expression.status!=='audio_descriptions')throw new Error('Expected retained audio');
 expect(report.expression.coverage.insufficientAnswers).toBe(1);expect(report.expression.answers[0]?.features.unitsPerMinute).toBeNull();
 const legacy=await buildInterviewReport(demo.reportInput);expect(legacy.expression.status).toBe('not_evaluated');
 expect(legacy.expression.speechRate).toBeNull();
});

test('speech mode is separate from content model mode, with no changes to technical scores',async()=>{
 const {demo,input}=await source(),proposal=await evaluateTurn(input,{evaluate:evaluator(input)});
 const report=await buildInterviewReport({...demo.reportInput,state:proposal.nextState,generatedAt:Date.now(),turns:[{input,proposal,evidenceMode:'live-model'}]});
 expect(report.evidenceMode).toBe('live-model');expect(report.warnings).toContain('contains_offline_speech');
 if(report.expression.status!=='audio_descriptions')throw new Error('Expected audio');
 expect(report.expression.speechEvidenceMode).toBe('offline-fixture');expect(report.assessments[0]!.evaluation).toEqual(proposal.evaluation);
 const textOnly={...input};delete(textOnly as {speech?:unknown}).speech;
 const textProposal=await evaluateTurn(textOnly,{evaluate:evaluator(input)});expect(textProposal.evaluation).toEqual(proposal.evaluation);
});

test('mixed text/speech coverage remains per-answer and has no pooled numerical speech score',async()=>{
 const {demo,input}=await source(),first=await evaluateTurn(input,{evaluate:evaluator(input)});
 const {speech:_,...text}=input;
 const secondInput={...text,state:first.nextState,expectedVersion:first.nextState.version,observationId:'second-observation',
  context:{...input.context,runId:'second-run'},question:{...input.question,id:'second-question'},answer:{id:'second-answer',text:input.answer.text}};
 const second=await evaluateTurn(secondInput,{evaluate:evaluator(input)});
 const report=await buildInterviewReport({...demo.reportInput,state:second.nextState,generatedAt:Date.now(),turns:[
  {input:secondInput,proposal:second,evidenceMode:'offline-fixture'},{input,proposal:first,evidenceMode:'offline-fixture'}]});
 if(report.expression.status!=='audio_descriptions')throw new Error('Expected partial audio coverage');
 expect(report.expression.coverage).toEqual({totalAnswers:2,speechAnswers:1,textAnswers:1,descriptiveAnswers:1,insufficientAnswers:0});
 expect(report.expression.speechRate).toBeNull();expect(report.expression.answers.map(a=>a.answerId)).toEqual([input.answer.id]);
 expect(report.assessments.map(a=>a.answerId)).toEqual([input.answer.id,secondInput.answer.id]);
});

test('one transcript or audio identity cannot be attached to two distinct answers in a report',async()=>{
 const {demo,input}=await source(),first=await evaluateTurn(input,{evaluate:evaluator(input)});
 for(const changeTranscriptId of [false,true]){
  const transcript=structuredClone(input.speech.transcription);if(changeTranscriptId)transcript.transcriptionId='new-transcription-same-audio';
  const speech=confirmSpeechAnswer(transcript,{transcriptionId:transcript.transcriptionId,audioSha256:transcript.audio.sha256,
   userId:transcript.userId,roleId:transcript.roleId,answerId:'second-answer',text:input.answer.text,confirmedAt:Date.now()});
  const next={...input,state:first.nextState,expectedVersion:first.nextState.version,observationId:'second-observation',
   context:{...input.context,runId:'second-run'},question:{...input.question,id:'second-question'},answer:{...speech.answer},speech};
  const proposal=await evaluateTurn(next,{evaluate:evaluator(input)});
  await expect(buildInterviewReport({...demo.reportInput,state:proposal.nextState,generatedAt:Date.now(),turns:[
   {input,proposal:first,evidenceMode:'offline-fixture'},{input:next,proposal,evidenceMode:'offline-fixture'}]})).rejects.toThrow('VALIDATION_ERROR');
 }
});
