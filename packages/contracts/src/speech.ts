import { z } from 'zod';
import { RoleIdSchema } from './tools.ts';
const id = z.string().min(1).max(100);
export const AsrOutputSchema = z.object({
  text: z.string().max(10000), language: z.enum(['zh-CN', 'en-US', 'mixed', 'unknown']),
  segments: z.array(z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(),
    text: z.string().min(1).max(2000), confidence: z.number().min(0).max(1).optional() }).strict()).max(500),
}).strict();
export const AudioFeaturesSchema = z.object({
  method: z.literal('pcm-rms-threshold-v1'), frameMs: z.literal(20), rmsThreshold: z.number().min(0.001).max(0.5),
  pauseMinMs: z.literal(300), durationMs: z.number().positive().max(120000), activeAudioMs: z.number().nonnegative(),
  leadingLowEnergyMs: z.number().nonnegative(), trailingLowEnergyMs: z.number().nonnegative(),
  internalPauses: z.array(z.object({ startMs: z.number().nonnegative(), endMs: z.number().positive(),
    durationMs: z.number().positive() }).strict()).max(400),
}).strict().superRefine((a,ctx)=>{
  let end=a.leadingLowEnergyMs;
  if(a.activeAudioMs+a.leadingLowEnergyMs+a.trailingLowEnergyMs+a.internalPauses.reduce((n,p)=>n+p.durationMs,0)>a.durationMs)
    ctx.addIssue({code:'custom',message:'Activity exceeds duration.'});
  for(const p of a.internalPauses){
    if(p.startMs<end||p.startMs<=0||p.endMs>=a.durationMs-a.trailingLowEnergyMs||p.endMs<=p.startMs||
      p.durationMs!==p.endMs-p.startMs||p.durationMs<a.pauseMinMs)
      ctx.addIssue({code:'custom',message:'Invalid internal low-energy interval.'});
    end=p.endMs;
  }
});
export const SpeechExpressionSchema = z.object({
  status: z.enum(['descriptive', 'insufficient_data']), textSource: z.literal('original_asr'),
  countMethod: z.literal('han-char-latin-alphanumeric-run-v1'), unitCount: z.number().int().nonnegative(),
  unitsPerMinute: z.number().nonnegative().nullable(), unitsPerActiveMinute: z.number().nonnegative().nullable(),
  audio: AudioFeaturesSchema, clarity: z.null(), confidence: z.null(), emotion: z.null(), warnings: z.array(z.string()),
}).strict();
export const SpeechTranscriptSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('uncommitted-speech-transcript'), transcriptionId: id,
  userId: id, roleId: RoleIdSchema, mode: z.enum(['offline-fixture', 'live-asr']),
  provider: z.object({ id, version: id }).strict(), startedAt: z.number().int().nonnegative(), completedAt: z.number().int().nonnegative(),
  audio: z.object({ audioId: id, sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().positive().max(4194304),
    sampleRate: z.literal(16000), channels: z.literal(1), bitsPerSample: z.literal(16), durationMs: z.number().positive().max(120000) }).strict(),
  originalText: AsrOutputSchema.shape.text, language: AsrOutputSchema.shape.language, segments: AsrOutputSchema.shape.segments,
  expression: SpeechExpressionSchema,
}).strict().superRefine((s, ctx) => {
  if (s.completedAt < s.startedAt || s.expression.audio.durationMs !== s.audio.durationMs)
    ctx.addIssue({ code: 'custom', message: 'Speech timeline mismatch.' });
  let end=0;
  for (const segment of s.segments) {
    if(segment.startMs<end||segment.endMs<=segment.startMs||segment.endMs>s.audio.durationMs)
      ctx.addIssue({code:'custom',message:'ASR segments overlap or exceed audio.'});
    end=segment.endMs;
  }
});
export const ConfirmSpeechSchema = z.object({ transcriptionId:id, audioSha256:z.string().regex(/^[a-f0-9]{64}$/),
  userId:id,roleId:RoleIdSchema,answerId:id,text:z.string().trim().min(1).max(10000),confirmedAt:z.number().int().nonnegative() }).strict();
export const SpeechAnswerSchema = z.object({kind:z.literal('uncommitted-speech-answer'),
  transcription:SpeechTranscriptSchema,answer:z.object({id,text:z.string().min(1).max(10000)}).strict(),
  confirmedAt:z.number().int().nonnegative(),expression:SpeechExpressionSchema,warnings:z.array(z.string())}).strict();
export type SpeechTranscript=z.infer<typeof SpeechTranscriptSchema>;
export type AudioFeatures=z.infer<typeof AudioFeaturesSchema>;
export type SpeechExpression=z.infer<typeof SpeechExpressionSchema>;
