import { ConfirmSpeechSchema, SpeechTranscriptSchema, SpeechAnswerSchema } from '../../../../packages/contracts/src/speech.ts';
import { AgentStateError } from '../planning/interview-state.ts';
import { describeSpeech } from './audio-features.ts';

/** The API must establish ownership and persist immutable source; this is not authentication. */
export function confirmSpeechAnswer(rawTranscript:unknown,rawConfirmation:unknown){
  const source=SpeechTranscriptSchema.safeParse(rawTranscript),confirmation=ConfirmSpeechSchema.safeParse(rawConfirmation);
  if(!source.success||!confirmation.success)throw new AgentStateError('VALIDATION_ERROR');
  const t=source.data,c=confirmation.data;
  if(c.userId!==t.userId)throw new AgentStateError('FORBIDDEN');
  if(c.roleId!==t.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
  if(c.transcriptionId!==t.transcriptionId||c.audioSha256!==t.audio.sha256)throw new AgentStateError('VERSION_CONFLICT');
  if(c.confirmedAt<t.completedAt)throw new AgentStateError('VALIDATION_ERROR');
  if(JSON.stringify(describeSpeech(t.originalText,t.expression.audio))!==JSON.stringify(t.expression))throw new AgentStateError('VALIDATION_ERROR');
  return SpeechAnswerSchema.parse({kind:'uncommitted-speech-answer',transcription:t,answer:{id:c.answerId,text:c.text},confirmedAt:c.confirmedAt,
    expression:t.expression,warnings:c.text!==t.originalText?['confirmed_text_differs_from_asr']:[]});
}
