import {z} from 'zod';import {HintAssistanceSchema} from './hints.ts';
import {PilotReportSchema} from './workbench.ts';
const id=z.string().min(1).max(100),count=z.number().int().nonnegative().max(200);
export const LOCAL_PRESENTATION_CAPABILITY='session-presentation-v1' as const;
export const LocalReadPageOptionsSchema=z.object({offset:count.default(0),limit:z.number().int().min(1).max(5).default(5),expectedRevision:z.number().int().min(-1).optional()}).strict();
export const LocalAnswerViewSchema=z.object({assistance:HintAssistanceSchema.optional(),questionId:id,questionText:z.string().max(4200),answerId:id,
 status:z.enum(['scored','needs_clarification','abstained']),reason:z.enum(['evidence_insufficient','clarification_limit','time_budget']).nullable(),
 rubricVersion:id,scope:z.enum(['technical-content','behavioral-content']),semanticSupport:z.literal('not_verified'),
 normalizedScore:z.number().min(0).max(1).nullable(),evidenceMode:z.enum(['offline-fixture','live-model','unverified']),
 strengths:z.array(z.string().max(500)).max(5),improvements:z.array(z.string().max(500)).max(5),
 feedbackStatus:z.enum(['draft-unverified','partially-withheld','withheld','not-scored']),withheldFeedbackCount:z.number().int().min(0).max(10),
 criteria:z.array(z.object({id,label:z.string().max(120),dimension:z.enum(['correctness','depth','ownership','logic','communication','relevance','verification']).nullable(),score:z.number().nonnegative().nullable(),maxScore:z.number().positive(),action:z.null()}).strict()).max(20),
 evidence:z.array(z.object({id,answerId:id,start:z.number().int().nonnegative(),end:z.number().int().positive(),excerpt:z.string().min(1).max(240),truncated:z.boolean()}).strict()).max(3),evidenceOmitted:z.number().int().nonnegative().max(100),
}).strict().superRefine((v,ctx)=>{
 if((v.status==='scored')!==(v.normalizedScore!==null)||(v.status==='scored')!==(v.reason===null)||v.status!=='scored'&&(v.criteria.length>0||v.evidence.length>0||v.strengths.length>0||v.improvements.length>0||v.feedbackStatus!=='not-scored')||v.evidence.some(e=>e.end-e.start!==e.excerpt.length||e.answerId!==v.answerId))ctx.addIssue({code:'custom',message:'Inconsistent public answer state.'});
});
function validPage(p:{offset:number;limit:number;total:number;nextOffset:number|null},length:number){return length<=p.limit&&length===Math.max(0,Math.min(p.limit,p.total-p.offset))&&p.nextOffset===(p.offset+length<p.total?p.offset+length:null);}
export const LocalAnswerPageSchema=z.object({presentationVersion:z.literal(1),sessionId:id,revision:z.number().int().min(-1),offset:count,limit:z.number().int().min(1).max(5),total:count,nextOffset:count.nullable(),items:z.array(LocalAnswerViewSchema).max(5)}).strict().superRefine((v,ctx)=>{if(!validPage(v,v.items.length))ctx.addIssue({code:'custom',message:'Inconsistent answer page.'});});
export const LocalSessionPresentationSchema=z.object({presentationVersion:z.literal(1),submittedCount:count,scoredCount:count,unscoredCount:count,needsClarification:z.boolean(),
 clarification:z.object({questionId:id,prompt:z.string().max(300),previousText:z.string().max(10000)}).strict().nullable(),lastAnswer:LocalAnswerViewSchema.nullable()}).strict();
export const LocalReportViewSchema=PilotReportSchema.extend({presentationVersion:z.literal(1),sessionId:id,revision:z.number().int().nonnegative(),generatedAt:z.number().int().nonnegative(),policyVersion:id,aggregation:z.literal('per-answer-only'),
 answers:z.array(LocalAnswerViewSchema).max(5),answerPage:z.object({offset:count,limit:z.number().int().min(1).max(5),total:count,nextOffset:count.nullable()}).strict(),
}).strict().superRefine((v,ctx)=>{if(!validPage(v.answerPage,v.answers.length)||v.answers.some(a=>a.status!=='scored')||v.answerPage.total!==v.coverage.scoredAnswers)ctx.addIssue({code:'custom',message:'Inconsistent report page.'});});
export type LocalAnswerView=z.infer<typeof LocalAnswerViewSchema>;
export type LocalReadPageOptions=z.input<typeof LocalReadPageOptionsSchema>;
export type LocalAnswerPage=z.infer<typeof LocalAnswerPageSchema>;
export type LocalReportView=z.infer<typeof LocalReportViewSchema>;
