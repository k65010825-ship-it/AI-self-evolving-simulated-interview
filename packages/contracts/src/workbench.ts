import {z} from 'zod';
import {RoleIdSchema} from './tools.ts';
const id=z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/);
export const PilotLoginSchema=z.object({userId:id,password:z.string().min(1).max(256)}).strict();
export const PilotSessionCreateSchema=z.object({operationId:id,roleId:RoleIdSchema,goal:z.string().trim().min(1).max(500),durationMinutes:z.number().int().min(15).max(25),pressure:z.boolean().default(false)}).strict();
export const PilotCommandSchema=z.object({operationId:id,expectedRevision:z.number().int().nonnegative()}).strict();
export const PilotAnswerSchema=PilotCommandSchema.extend({text:z.string().trim().min(1).max(10000),speechId:id.optional()}).strict();
export const PilotSpeechCreateSchema=z.object({expectedRevision:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/),byteLength:z.number().int().min(44).max(4194304)}).strict();
export const PilotSpeechConfirmSchema=z.object({expectedVersion:z.number().int().nonnegative(),text:z.string().trim().min(1).max(10000)}).strict();
export const PilotReportSchema=z.object({evidenceMode:z.string(),coverage:z.object({totalAnswers:z.number(),scoredAnswers:z.number(),unscoredAnswers:z.number()}),
 skills:z.array(z.object({skillId:z.string(),label:z.string(),mastery:z.number().nullable(),confidence:z.number()})),
 answers:z.array(z.object({questionId:z.string(),questionText:z.string(),strengths:z.array(z.string()),improvements:z.array(z.string()),
  criteria:z.array(z.object({id:z.string(),label:z.string(),score:z.number().nullable(),maxScore:z.number(),action:z.string().nullable()}))})),
 studyPlan:z.array(z.object({skillId:z.string(),label:z.string(),minutes:z.number(),actions:z.array(z.string())})),
 unscoredAnswers:z.array(z.object({questionId:z.string(),reason:z.string()})),warnings:z.array(z.string()),
 expression:z.object({status:z.string(),summary:z.array(z.string())}),
}).strict();
export const PilotSessionViewSchema=z.object({sessionId:id,roleId:RoleIdSchema,revision:z.number().int(),phase:z.string(),startedAt:z.number(),deadlineAt:z.number(),
 question:z.object({id:z.string(),text:z.string()}).strict().nullable(),clarification:z.object({prompt:z.string(),previousText:z.string()}).strict().nullable(),
 answeredCount:z.number().int().nonnegative(),scoredCount:z.number().int().nonnegative(),unscoredCount:z.number().int().nonnegative(),
 report:PilotReportSchema.nullable(),evidenceMode:z.enum(['offline-fixture','live-model']),knowledgeStatus:z.enum(['draft-pilot','reviewed-only']),
}).strict();
export const PilotOperationViewSchema=z.object({operationId:id,sessionId:id,status:z.enum(['running','completed','failed','interrupted']),errorCode:z.string().nullable()}).strict();
export const PilotSpeechViewSchema=z.object({speechId:id,status:z.string(),version:z.number().int().nonnegative(),originalText:z.string().nullable(),confirmedText:z.string().nullable(),
 errorCode:z.string().nullable(),expression:z.array(z.string()),prefixText:z.string().nullable()}).strict();
export const PilotRolesSchema=z.array(z.object({id:RoleIdSchema,label:z.string(),skills:z.array(z.string())}));
export type PilotSessionView=z.infer<typeof PilotSessionViewSchema>;
export type PilotOperationView=z.infer<typeof PilotOperationViewSchema>;
export type PilotSpeechView=z.infer<typeof PilotSpeechViewSchema>;
export type PilotReport=z.infer<typeof PilotReportSchema>;
