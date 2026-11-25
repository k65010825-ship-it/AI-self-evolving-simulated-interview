import {z} from 'zod';import {HintAssistanceSchema} from './hints.ts';
import {PilotReportSchema} from './workbench.ts';
import {RoleIdSchema} from './tools.ts';
import {ROLE_CATALOG_VERSION,RoleSkillCategorySchema} from './role-catalog.ts';
import {EvidenceModeSchema} from './report.ts';
import {ResourceRecordSchema} from './resources.ts';
import {RatioSchema,ReflectionSchema} from './reflection.ts';
const id=z.string().min(1).max(100),count=z.number().int().nonnegative().max(200);
export const LOCAL_PRESENTATION_CAPABILITY='session-presentation-v1' as const;
export const LOCAL_PROGRESS_VIEWS_CAPABILITY='local-progress-views-v1' as const;
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
const sha256=z.string().regex(/^[a-f0-9]{64}$/),progressLimit=z.number().int().min(1).max(20).default(20),offsetInt=z.number().int().min(0).max(1000000).default(0);
const LearningDisplayStatusSchema=z.enum(['unavailable','not_started','in_progress','self_reported','verified_complete']);
const ProgressPageSchema=z.object({offset:z.number().int().nonnegative(),limit:z.number().int().min(1).max(20),total:z.number().int().nonnegative(),nextOffset:z.number().int().nonnegative().nullable()}).strict();
export const LocalProfileQuerySchema=z.object({roleId:RoleIdSchema,offset:offsetInt,limit:progressLimit,expectedMemoryVersion:z.number().int().nonnegative().optional()}).strict();
export const LocalProfileSkillViewSchema=z.object({skillId:id,label:z.string().max(120),category:RoleSkillCategorySchema,mastery:z.number().min(0).max(1).nullable(),confidence:z.number().min(0).max(1),independentQuestions:z.number().int().nonnegative(),assistedExcludedCount:z.number().int().nonnegative(),incompatibleExcludedCount:z.number().int().nonnegative()}).strict();
export const LocalGrowthPointSchema=z.object({sessionId:id,endedAt:z.number().int().nonnegative(),policyVersion:id,evidenceMode:EvidenceModeSchema,scoredAnswers:count,independentQuestions:count,rubricScope:z.enum(['technical-content','behavioral-content','mixed-content']).nullable(),
 skillScores:z.array(z.object({skillId:id,label:z.string().max(120),averageScore:z.number().min(0).max(1).nullable(),rubricVersions:z.array(z.string().max(120)),assistedCount:count}).strict()).max(20)}).strict();
export const LocalProfileViewSchema=z.object({presentationVersion:z.literal(1),roleId:RoleIdSchema,catalogVersion:z.literal(ROLE_CATALOG_VERSION),generatedAt:z.number().int().nonnegative(),memoryVersion:z.number().int().nonnegative(),sourceDigest:sha256,
 mainSkills:z.array(LocalProfileSkillViewSchema).length(6),behavioralSkills:z.array(LocalProfileSkillViewSchema).length(1),growthPage:ProgressPageSchema,growthPoints:z.array(LocalGrowthPointSchema).max(20),warnings:z.array(z.string().max(300)).max(20)}).strict().superRefine((v,ctx)=>{if(!validPage(v.growthPage,v.growthPoints.length))ctx.addIssue({code:'custom',message:'Inconsistent growth page.'});});
export const LocalPracticeRecommendationsQuerySchema=z.object({roleId:RoleIdSchema,maxGoals:z.number().int().min(1).max(5).default(3)}).strict();
export const LocalPracticeRecommendationsViewSchema=z.object({presentationVersion:z.literal(1),roleId:RoleIdSchema,generatedAt:z.number().int().nonnegative(),memoryVersion:z.number().int().nonnegative(),sourceDigest:sha256,learningProgressAvailable:z.boolean(),
 goals:z.array(z.object({skillId:id,label:z.string().max(120),mastery:z.number().min(0).max(1).nullable(),confidence:z.number().min(0).max(1),priority:z.number().min(0).max(1),reason:z.enum(['weak_evidence','uncertain_evidence','no_evidence']),action:z.string().max(400),learningStatus:LearningDisplayStatusSchema}).strict()).max(5),
 resources:z.array(z.object({skillId:id,reason:z.enum(['assess_unknown','repair_gap','verify_uncertainty']),explanation:z.string().max(500),catalogVersion:id,learningStatus:LearningDisplayStatusSchema,resource:ResourceRecordSchema}).strict()).max(10),
 warnings:z.array(z.string().max(300)).max(20)}).strict();
export const LocalReflectionListQuerySchema=z.object({roleId:RoleIdSchema,offset:offsetInt,limit:progressLimit,expectedSourceDigest:sha256.optional()}).strict();
export const LocalReflectionItemViewSchema=z.object({sessionId:id,generatedAt:z.number().int().nonnegative(),policyVersion:id,evidenceMode:EvidenceModeSchema,
 metrics:z.object({skillCoverage:RatioSchema,repeatRate:RatioSchema,planAdherence:RatioSchema,longestSkillRun:z.number().int().nonnegative()}).strict(),
 findings:z.array(z.object({code:z.enum(['coverage_gap','repeated_question','plan_mismatch','insufficient_evidence','assisted_evidence']),count:z.number().int().nonnegative()}).strict()),
 candidate:z.object({id,baselineId:z.string().min(1).max(80),changes:ReflectionSchema.shape.candidate.unwrap().shape.changes}).strict().nullable(),
 planning:ReflectionSchema.shape.planning}).strict();
export const LocalReflectionListViewSchema=z.object({presentationVersion:z.literal(1),roleId:RoleIdSchema,generatedAt:z.number().int().nonnegative(),sourceDigest:sha256,deploymentStatus:z.literal('not_published'),
 calibration:z.object({status:z.enum(['unavailable','insufficient_data']),mae:z.null(),minimumPairs:z.literal(8),minimumStudents:z.literal(2),reason:z.string().max(240)}).strict(),
 page:ProgressPageSchema,items:z.array(LocalReflectionItemViewSchema).max(20)}).strict().superRefine((v,ctx)=>{if(!validPage(v.page,v.items.length))ctx.addIssue({code:'custom',message:'Inconsistent reflection page.'});});
export type LocalProfileView=z.infer<typeof LocalProfileViewSchema>;
export type LocalPracticeRecommendationsView=z.infer<typeof LocalPracticeRecommendationsViewSchema>;
export type LocalReflectionListView=z.infer<typeof LocalReflectionListViewSchema>;
export type LocalProfileQuery=z.input<typeof LocalProfileQuerySchema>;
export type LocalPracticeRecommendationsQuery=z.input<typeof LocalPracticeRecommendationsQuerySchema>;
export type LocalReflectionListQuery=z.input<typeof LocalReflectionListQuerySchema>;
