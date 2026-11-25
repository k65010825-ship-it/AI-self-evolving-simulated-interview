import {z} from 'zod';import {RoleIdSchema} from './tools.ts';
import {PracticeModeSchema} from './role-catalog.ts';
import {LocalReadPageOptionsSchema,LocalSessionPresentationSchema,LocalReportViewSchema} from './local-presentation.ts';
import {LiveServiceConfigSchema} from './live-model.ts';
import {LocalSpeechPolicySchema} from './local-speech.ts';
import {LocalSpeechCommandSchemas} from './local-speech-api.ts';
import {LocalSessionBudgetLimitsSchema} from './local-live.ts';
import {EvaluationDiagnosticSchema} from './evaluation-diagnostic.ts';
export const LocalId=z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/);
const mutation={operationId:LocalId,sessionId:LocalId,expectedRevision:z.number().int().nonnegative()};
export const LocalCommandSchemas={
 'session.create':z.object({operationId:LocalId,roleId:RoleIdSchema,goal:z.string().trim().min(1).max(500),durationMinutes:z.number().int().min(15).max(25),pressure:z.boolean().default(false),practiceMode:PracticeModeSchema.default('weakness-focus'),mode:z.enum(['offline-fixture','live']).default('offline-fixture'),liveConfig:LiveServiceConfigSchema.optional(),sessionBudget:LocalSessionBudgetLimitsSchema.optional(),speech:LocalSpeechPolicySchema.optional()}).strict().refine(v=>v.mode==='live'?v.liveConfig?.planning==='pi-knowledge'&&!!v.sessionBudget:!v.liveConfig&&!v.sessionBudget),
 'session.nextQuestion':z.object(mutation).strict(),
 'session.answer':z.object({...mutation,text:z.string().trim().min(1).max(10000)}).strict(),
 'session.complete':z.object(mutation).strict(),
};
export type LocalCommand=keyof typeof LocalCommandSchemas;
export const LocalMethodSchema=z.enum(['runtime.initialize','runtime.status','runtime.shutdown','live.authorize','live.revoke','live.budget','live.reconcile','roles.list','hint.status','hint.request','profile.get','practice.recommendations','reflection.list','learning.status','learning.assignment.create','learning.event.record','learning.retest.plan','learning.retest.pair','experiment.status','experiment.evaluate','experiment.rollback','session.create','session.nextQuestion','session.answer','session.complete','session.list','session.get','session.answers','session.report','memory.get','job.get','job.cancel','job.events',...Object.keys(LocalSpeechCommandSchemas) as (keyof typeof LocalSpeechCommandSchemas)[]]);
export const LocalRequestSchema=z.object({protocolVersion:z.literal(1),type:z.literal('request'),id:LocalId,method:LocalMethodSchema,params:z.unknown()}).strict();
export const LocalResponseSchema=z.discriminatedUnion('ok',[
 z.object({protocolVersion:z.literal(1),type:z.literal('response'),id:LocalId,ok:z.literal(true),result:z.unknown()}).strict(),
 z.object({protocolVersion:z.literal(1),type:z.literal('response'),id:LocalId,ok:z.literal(false),error:z.object({code:z.string().regex(/^[A-Z_]{1,80}$/)}).strict()}).strict(),
]);
export const LocalEventSchema=z.object({jobId:LocalId,seq:z.number().int().positive(),status:z.enum(['queued','running','candidate-ready','completed','failed','cancelled','interrupted']),stage:z.string().nullable(),diagnostic:EvaluationDiagnosticSchema.optional()}).strict().superRefine((v,ctx)=>{
 if(v.diagnostic&&(v.status!=='running'||v.stage!==v.diagnostic.stage))ctx.addIssue({code:'custom',message:'Diagnostic must belong to an active evaluation stage.'});
});
export const LocalNotificationSchema=z.object({protocolVersion:z.literal(1),type:z.literal('event'),event:LocalEventSchema}).strict();
export const LocalJobViewSchema=z.object({jobId:LocalId,operationId:LocalId,sessionId:LocalId,status:z.enum(['queued','running','completed','failed','cancelled','interrupted']),errorCode:z.string().nullable()}).strict();
export type LocalRequest=z.infer<typeof LocalRequestSchema>;
export type LocalEvent=z.infer<typeof LocalEventSchema>;
export const LocalReadPageSchema=LocalReadPageOptionsSchema.extend({sessionId:LocalId}).strict();
export const LocalSessionViewSchema=z.object({...LocalSessionPresentationSchema.shape,viewKind:z.enum(['full','summary']),startedAt:z.number().int().nonnegative(),hasReport:z.boolean(),sessionId:LocalId,roleId:RoleIdSchema,revision:z.number().int(),phase:z.string(),deadlineAt:z.number().int(),mode:z.enum(['offline-fixture','live']),authorizationStatus:z.enum(['not-required','required','authorized']),
 question:z.object({id:z.string(),text:z.string()}).strict().nullable(),answeredCount:z.number().int().nonnegative(),priorEvidenceCount:z.number().int().nonnegative(),report:LocalReportViewSchema.nullable(),
 lastOperation:LocalJobViewSchema.nullable()}).strict();
