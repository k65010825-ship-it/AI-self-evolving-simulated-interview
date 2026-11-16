import {z} from 'zod';import {SpeechTranscriptSchema,SpeechAnswerSchema} from './speech.ts';
const id=z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/),revision=z.number().int().nonnegative(),session={operationId:id,sessionId:id,expectedRevision:revision};
export const LocalSpeechCommandSchemas={
 'speech.upload.begin':z.object({...session,byteLength:z.number().int().min(44).max(4194304),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 'speech.upload.chunk':z.object({audioId:id,index:revision,base64:z.string().min(4).max(43692)}).strict(),
 'speech.upload.finish':z.object({audioId:id}).strict(),
 'speech.asr.start':z.object({operationId:id,audioId:id,expectedRevision:revision}).strict(),
 'speech.task.get':z.object({jobId:id}).strict(),
 'speech.confirm':z.object({operationId:id,jobId:id,expectedVersion:revision,expectedRevision:revision,text:z.string().trim().min(1).max(10000)}).strict(),
 'speech.answer.retry':z.object({operationId:id,jobId:id,expectedRevision:revision}).strict(),
 'speech.tts.start':z.object(session).strict(),
 'speech.audio.read':z.object({jobId:id,offset:revision}).strict(),
 'speech.audio.release':z.union([z.object({audioId:id}).strict(),z.object({jobId:id}).strict()]),
 'speech.authorize':z.object({sessionId:id,capability:z.enum(['asr','tts']),grantId:id,credentialRef:id,expiresAt:revision,expectedVersion:revision}).strict(),
 'speech.revoke':z.object({sessionId:id,capability:z.enum(['asr','tts']),expectedVersion:revision}).strict(),
 'speech.budget':z.object({sessionId:id}).strict(),
 'speech.reconcile':z.object({sessionId:id,callId:id,expectedVersion:revision,status:z.enum(['responded','rejected']),evidenceRef:z.string().min(1).max(200)}).strict(),
};
export type LocalSpeechCommand=keyof typeof LocalSpeechCommandSchemas;
export const LocalSpeechTaskSchema=z.object({
 kind:z.enum(['upload','asr','tts']),jobId:id,operationId:id,requestDigest:z.string().regex(/^[a-f0-9]{64}$/),sessionId:id,questionId:z.string().min(1).max(100),revision,createdAt:revision,deadlineAt:revision,version:revision,
 status:z.enum(['uploading','ready','queued','running','transcribed','confirmed','completed','failed','cancelled','interrupted']),
 audioId:id.optional(),answerId:id.optional(),byteLength:revision.optional(),sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),transcript:SpeechTranscriptSchema.optional(),
 confirmedAnswer:SpeechAnswerSchema.optional(),confirmationDigest:z.string().regex(/^[a-f0-9]{64}$/).optional(),confirmationRequestDigest:z.string().regex(/^[a-f0-9]{64}$/).optional(),confirmationId:id.optional(),confirmOperationId:id.optional(),confirmJobId:id.optional(),operations:z.array(z.object({operationId:id,requestDigest:z.string().regex(/^[a-f0-9]{64}$/),jobId:id}).strict()).max(101).optional(),errorCode:z.string().regex(/^[A-Z_]+$/).optional(),
 grantId:id.optional(),callId:id.optional(),
}).strict();
export type LocalSpeechTask=z.infer<typeof LocalSpeechTaskSchema>;

export const LocalSpeechTaskViewSchema=LocalSpeechTaskSchema.pick({jobId:true,kind:true,sessionId:true,questionId:true,version:true,status:true,transcript:true,errorCode:true}).extend({answer:SpeechAnswerSchema.optional()}).strict();
export const LocalSpeechAudioChunkSchema=z.object({base64:z.string().max(43692),nextOffset:revision,eof:z.boolean(),mimeType:z.literal('audio/wav'),sampleRate:z.literal(24000)}).strict();
