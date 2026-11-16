import {z} from 'zod';
import {RoleIdSchema,ToolContextSchema,ErrorCodeSchema} from './tools.ts';
import {SpeechTranscriptSchema,SpeechAnswerSchema} from './speech.ts';
import {AsrAccountingSchema} from './asr-service.ts';
import {ExpressionAssessmentSchema} from './expression-assessment.ts';
export const SpeechTaskIdSchema=z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/);
export const SpeechOwnerSchema=z.object({userId:z.string().min(1).max(100),roleId:RoleIdSchema}).strict();
export const SpeechBindingSchema=z.object({sessionId:SpeechTaskIdSchema,questionId:SpeechTaskIdSchema,answerId:SpeechTaskIdSchema,
 sessionVersion:z.number().int().nonnegative()}).strict();
export const SpeechTaskCreateSchema=z.object({speechId:SpeechTaskIdSchema,context:ToolContextSchema.extend({userId:z.string().min(1).max(100),
 runId:SpeechTaskIdSchema,attemptId:SpeechTaskIdSchema,deadlineAt:z.number().int().nonnegative()}),binding:SpeechBindingSchema,
 audio:z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/),byteLength:z.number().int().min(44).max(4194304)}).strict(),
}).strict().refine(r=>r.speechId===r.context.runId,'Speech task and run IDs must match');
export const SpeechTaskConfirmationSchema=z.object({expectedVersion:z.number().int().nonnegative(),text:z.string().trim().min(1).max(10000)}).strict();
export const SpeechTaskSnapshotSchema=z.object({schemaVersion:z.literal(1),kind:z.literal('uncommitted-speech-task'),
 request:SpeechTaskCreateSchema,version:z.number().int().nonnegative(),status:z.enum(['awaiting_audio','running','transcribed','confirmed','failed','cancelled','interrupted']),
 createdAt:z.number().int().nonnegative(),updatedAt:z.number().int().nonnegative(),executionDeadlineAt:z.number().int().nonnegative().optional(),
 transcript:SpeechTranscriptSchema.optional(),answer:SpeechAnswerSchema.optional(),accounting:AsrAccountingSchema.optional(),errorCode:ErrorCodeSchema.optional(),
 expressionAssessment:ExpressionAssessmentSchema.optional(),expressionError:ErrorCodeSchema.optional(),
}).strict().superRefine((s,c)=>{
 const r=s.request,t=s.transcript,answer=s.answer;
 if(s.updatedAt<s.createdAt||['transcribed','confirmed'].includes(s.status)!==!!t||(s.status==='confirmed')!==!!answer)
  c.addIssue({code:'custom',message:'Speech task state/result mismatch'});
 if(t&&(t.transcriptionId!==`transcript-${r.speechId}`||t.userId!==r.context.userId||t.roleId!==r.context.roleId||t.audio.audioId!==r.speechId||t.audio.sha256!==r.audio.sha256||t.audio.byteLength!==r.audio.byteLength))
  c.addIssue({code:'custom',message:'Speech source binding mismatch'});
 if(answer&&(answer.answer.id!==r.binding.answerId||JSON.stringify(answer.transcription)!==JSON.stringify(t)))
  c.addIssue({code:'custom',message:'Speech confirmation binding mismatch'});
 if(s.expressionAssessment&&(!t||s.expressionAssessment.source.audioSha256!==r.audio.sha256||s.expressionAssessment.source.durationMs!==t.audio.durationMs||
  [s.expressionAssessment.clarity,s.expressionAssessment.confidentDelivery,s.expressionAssessment.vocalValence].some(m=>m.evidenceIntervals.some(e=>!t.originalText.includes(e.quote)))))
  c.addIssue({code:'custom',message:'Expression estimate must bind the saved audio and original transcript'});
 if(s.accounting){const a=s.accounting.context;
  if(a.userId!==r.context.userId||a.roleId!==r.context.roleId||a.runId!==r.context.runId||a.attemptId!==r.context.attemptId||a.deadlineAt!==s.executionDeadlineAt)
   c.addIssue({code:'custom',message:'Speech accounting binding mismatch'});
 }
});
export type SpeechTaskCreate=z.infer<typeof SpeechTaskCreateSchema>;
export type SpeechTaskSnapshot=z.infer<typeof SpeechTaskSnapshotSchema>;
export type SpeechOwner=z.infer<typeof SpeechOwnerSchema>;
