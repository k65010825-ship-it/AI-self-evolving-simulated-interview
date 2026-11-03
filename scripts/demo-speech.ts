import { pathToFileURL } from 'node:url';
import { makeSpeechFixture } from '../experiments/speech/fixture.ts';
import { transcribeSpeech } from '../apps/agent/src/speech/transcribe.ts';
import { confirmSpeechAnswer } from '../apps/agent/src/speech/confirm.ts';
import type { RoleId } from '../packages/contracts/src/tools.ts';

export async function runSpeechDemo(roleId:RoleId='java-backend'){
  const f=makeSpeechFixture(roleId),transcript=await transcribeSpeech(f.input,{provider:f.provider});
  const candidate=confirmSpeechAnswer(transcript,{transcriptionId:transcript.transcriptionId,audioSha256:transcript.audio.sha256,
    userId:transcript.userId,roleId,answerId:`answer-${roleId}`,text:f.text+'。',confirmedAt:Date.now()});
  return{roleId,mode:transcript.mode,audioSource:'generated-sine-and-silence',asrSource:'hand-authored-transcript',liveModelCalls:0,
    committed:false,candidateKind:candidate.kind,durationMs:transcript.audio.durationMs,activeAudioMs:transcript.expression.audio.activeAudioMs,
    internalPauses:transcript.expression.audio.internalPauses,unitCount:transcript.expression.unitCount,
    unitsPerMinute:transcript.expression.unitsPerMinute,unitsPerActiveMinute:transcript.expression.unitsPerActiveMinute,
    clarity:transcript.expression.clarity,confidence:transcript.expression.confidence,emotion:transcript.expression.emotion,
    warnings:[...transcript.expression.warnings,...candidate.warnings]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  for(const roleId of ['java-backend','web-frontend']as const)console.log(JSON.stringify(await runSpeechDemo(roleId),null,2));
}
