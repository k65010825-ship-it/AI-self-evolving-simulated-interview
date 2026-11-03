import { SpeechAnswerSchema } from '../../../../packages/contracts/src/speech.ts';
import type { RoleId } from '../../../../packages/contracts/src/tools.ts';
import { AgentStateError } from '../planning/interview-state.ts';
import { confirmSpeechAnswer } from './confirm.ts';

/** Revalidate at both first evaluation and historical report replay; API authenticates the source. */
export function validateSpeechForTurn(raw:unknown,binding:{userId:string;roleId:RoleId;answer:{id:string;text:string};sessionStartedAt:number;at:number}){
  const parsed=SpeechAnswerSchema.safeParse(raw);
  if(!parsed.success)throw new AgentStateError('VALIDATION_ERROR');
  const candidate=parsed.data,t=candidate.transcription;
  if(t.userId!==binding.userId)throw new AgentStateError('FORBIDDEN');
  if(t.roleId!==binding.roleId)throw new AgentStateError('ROLE_FORBIDDEN');
  if(candidate.answer.id!==binding.answer.id||candidate.answer.text!==binding.answer.text)throw new AgentStateError('VERSION_CONFLICT');
  if(!Number.isSafeInteger(binding.at)||binding.at<binding.sessionStartedAt||t.startedAt<binding.sessionStartedAt||candidate.confirmedAt>binding.at)
    throw new AgentStateError('VALIDATION_ERROR');
  const canonical=confirmSpeechAnswer(t,{transcriptionId:t.transcriptionId,audioSha256:t.audio.sha256,
    userId:binding.userId,roleId:binding.roleId,answerId:candidate.answer.id,text:candidate.answer.text,confirmedAt:candidate.confirmedAt});
  if(JSON.stringify(canonical)!==JSON.stringify(candidate))throw new AgentStateError('VALIDATION_ERROR');
  return canonical;
}
