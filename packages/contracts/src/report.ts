import {HintAssistanceSchema} from './hints.ts';
import { z } from 'zod';
import { InterviewStateSchema } from './interview-state.ts';
import { RoleIdSchema,KnowledgeItemSchema } from './tools.ts';
import { TurnInputSchema, TurnProposalSchema } from './evaluation.ts';
import { RubricSchema, ScoringResultSchema, ScoringContextSchema } from './scoring.ts';
import { ResourceRecommendationSchema, ResourceReceiptSchema } from './resources.ts';
import { SpeechExpressionSchema, SpeechTranscriptSchema } from './speech.ts';
import { CriterionMetadata } from './rubric-dimensions.ts';
import {WorkflowClarificationAttemptSchema} from './workflow-clarification.ts';
import {DisplayFeedbackSchema,FeedbackPublicationSchema} from './feedback-publication.ts';
const id = z.string().min(1).max(100);
export const EvidenceModeSchema = z.enum(['offline-fixture', 'live-model', 'unverified', 'mixed']);
export const CriterionFeedbackSchema=z.object({answerId:id,questionId:id,criterionId:id,rubricId:id,rubricVersion:id,
 scope:RubricSchema.shape.scope,dimension:CriterionMetadata.dimension,requirement:z.string().min(1).max(1000),evidenceRule:z.string().max(1000).nullable(),
 status:z.enum(['scored_gap','scored_strength','not_scored']),score:z.number().nonnegative().nullable(),maxScore:z.number().positive().max(100),
 normalizedScore:z.number().min(0).max(1).nullable(),priority:z.number().min(0).max(1),evidenceIds:z.array(id).max(30),
 nextAnchor:z.object({score:z.number().nonnegative().max(100),description:z.string().min(1).max(1000)}).strict().nullable(),
 action:z.string().min(1).max(5000),semanticSupport:z.literal('not_verified')}).strict();
export const ReportTurnSchema = z.object({ input: TurnInputSchema, proposal: TurnProposalSchema,
  evidenceMode: z.enum(['offline-fixture', 'live-model', 'unverified']) }).strict();
export const ReportInputSchema = z.object({ state: InterviewStateSchema, generatedAt: z.number().int().nonnegative(),
  policyVersion: id, skillLabels: z.record(id, z.string().trim().min(1).max(80)), turns: z.array(ReportTurnSchema).max(200),
  unscoredTurns:z.array(WorkflowClarificationAttemptSchema).max(200).optional() }).strict();
export const ReportExpressionSchema=z.discriminatedUnion('status',[
  z.object({status:z.literal('not_evaluated'),reason:z.enum(['audio_and_expression_evaluation_not_integrated','no_confirmed_audio']),
    speechRate:z.null(),clarity:z.null(),confidence:z.null()}).strict(),
  z.object({status:z.literal('audio_descriptions'),scope:z.literal('audio-timing-only'),
    speechEvidenceMode:z.enum(['offline-fixture','live-asr','mixed']),
    coverage:z.object({totalAnswers:z.number().int().nonnegative(),speechAnswers:z.number().int().positive(),
      textAnswers:z.number().int().nonnegative(),descriptiveAnswers:z.number().int().nonnegative(),insufficientAnswers:z.number().int().nonnegative()}).strict(),
    answers:z.array(z.object({answerId:id,questionId:id,transcriptionId:id,
      audio:SpeechTranscriptSchema.shape.audio,mode:SpeechTranscriptSchema.shape.mode,provider:SpeechTranscriptSchema.shape.provider,
      confirmedAt:z.number().int().nonnegative(),originalText:z.string().max(10000),confirmedText:z.string().min(1).max(10000),
      features:SpeechExpressionSchema,warnings:z.array(z.string())}).strict()).min(1).max(200),
    speechRate:z.null(),clarity:z.null(),confidence:z.null(),emotion:z.null(),
  }).strict(),
]);
export const ContentReportSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('uncommitted-content-report'),
  sessionId: id, sessionVersion: z.number().int().nonnegative(), roleId: RoleIdSchema, generatedAt: z.number().int().nonnegative(),
  policyVersion: id, evidenceMode: EvidenceModeSchema, scope: z.enum(['technical-content','behavioral-content','mixed-content']),
  coverage: z.object({ totalSkills: z.number().int().nonnegative(), observedSkills: z.number().int().nonnegative(),
    totalAnswers: z.number().int().nonnegative(), independentQuestions: z.number().int().nonnegative(),
    scoredAnswers:z.number().int().nonnegative().optional(),unscoredAnswers:z.number().int().nonnegative().optional() }).strict(),
  unscoredAnswers:z.array(z.object({assistance:HintAssistanceSchema.optional(),answerId:id,questionId:id,skillId:id,status:z.enum(['needs_clarification','abstained']),
    reason:z.enum(['evidence_insufficient','clarification_limit','time_budget']),normalizedScore:z.null(),missingCriterionIds:z.array(id),
    evidenceMode:z.enum(['offline-fixture','live-model','unverified'])}).strict()).max(200).optional(),
  skills: z.array(z.object({ skillId: id, label: z.string(), mastery: z.number().min(0).max(1).nullable(),
    confidence: z.number().min(0).max(1), independentQuestions: z.number().int().nonnegative(),
    rubricVersions: z.array(z.object({ id, version: id }).strict()) }).strict()),
  assessments: z.array(z.object({ observationId: id, answerId: id, questionId: id, skillId: id,
    questionType:KnowledgeItemSchema.shape.questionType.optional(),
    assistance:HintAssistanceSchema.optional(),questionText: z.string(),presentedText:z.string().min(1).max(4200).optional(),presentationReview:z.enum(['pending','not-applicable']).optional(), difficulty: z.number().int().min(1).max(5), rubricId: id, rubricVersion: id,
    rubric: RubricSchema, evaluation: ScoringResultSchema, evidence: ScoringContextSchema.shape.evidence,
    feedback: DisplayFeedbackSchema,feedbackPublication:FeedbackPublicationSchema.optional(), feedbackVerification:z.literal('not_verified').optional(), evidenceMode: EvidenceModeSchema,
    criterionFeedback:z.array(CriterionFeedbackSchema).max(20).optional() }).strict()),
  expression: ReportExpressionSchema,
  studyPlan: z.array(z.object({ skillId: id, label: z.string(), reason: z.enum(['assess_unknown', 'repair_gap', 'verify_uncertainty']),
    minutes: z.number().int().positive(), actions: z.array(z.string()).min(1), evidenceAnswerIds: z.array(id),
    feedbackRefs:z.array(z.object({answerId:id,criterionId:id}).strict()).max(3).optional(),
    retest: z.object({ requireDifferentQuestion: z.literal(true), excludeQuestionIds: z.array(id),
      successCriteria: z.string().min(1) }).strict() }).strict()).max(3),
  resourceRecommendations: z.array(ResourceRecommendationSchema).max(6), warnings: z.array(z.string()),
}).strict().superRefine((r,ctx)=>{
 let invalid=false;
 for(const a of r.assessments){
  const p=a.feedbackPublication;
  if(!p){if(a.feedback.improvements.length===0)invalid=true;continue;}
  if((['strengths','improvements'] as const).some(k=>a.feedback[k].length!==p.items.filter(i=>i.kind===k&&i.status!=='withheld').length))invalid=true;
 }
 if(r.unscoredAnswers!==undefined||r.coverage.scoredAnswers!==undefined||r.coverage.unscoredAnswers!==undefined){
  const u=r.unscoredAnswers??[];
  if(!u.length||r.coverage.scoredAnswers!==r.assessments.length||r.coverage.unscoredAnswers!==u.length||r.coverage.totalAnswers!==r.assessments.length+u.length
   ||new Set(u.map(a=>a.questionId)).size!==u.length||u.some(a=>r.assessments.some(s=>s.questionId===a.questionId||s.answerId===a.answerId)))invalid=true;
 }
 for(const a of r.assessments){if(a.presentedText===undefined?a.presentationReview!==undefined:
   a.presentationReview!==(a.presentedText===a.questionText?'not-applicable':'pending')||(a.presentedText!==a.questionText&&!a.presentedText.endsWith('\n'+a.questionText)))invalid=true;}
 if(r.assessments.some(a=>a.criterionFeedback!==undefined)||r.studyPlan.some(p=>p.feedbackRefs!==undefined)){
  if(new Set(r.assessments.map(a=>a.answerId)).size!==r.assessments.length||new Set(r.assessments.map(a=>a.observationId)).size!==r.assessments.length)invalid=true;
 }
 for(const a of r.assessments){const cards=a.criterionFeedback;if(!cards)continue;
  if(a.rubric.roleId!==r.roleId||a.rubricId!==a.rubric.id||a.rubricVersion!==a.rubric.version||a.evaluation.answerId!==a.answerId||a.evaluation.rubricId!==a.rubricId
   ||a.evaluation.rubricVersion!==a.rubricVersion||a.evaluation.scope!==a.rubric.scope)invalid=true;
  if(cards.length!==a.evaluation.dimensions.length||new Set(cards.map(c=>c.criterionId)).size!==cards.length)invalid=true;
  for(const card of cards){const c=a.rubric.criteria.find(c=>c.id===card.criterionId),d=a.evaluation.dimensions.find(d=>d.criterionId===card.criterionId);
   if(!c||!d){invalid=true;continue;}
   const anchor=d.score===null?null:c.anchors?.find(x=>x.score>d.score!)??null;
   if(card.answerId!==a.answerId||card.questionId!==a.questionId||card.rubricId!==a.rubricId||card.rubricVersion!==a.rubricVersion||card.scope!==a.rubric.scope
    ||card.dimension!==c.dimension||card.requirement!==(c.description??c.id)||card.evidenceRule!==(c.evidenceRule??null)
    ||card.score!==d.score||card.maxScore!==c.maxScore||card.normalizedScore!==d.normalizedScore||JSON.stringify(card.evidenceIds)!==JSON.stringify(d.evidenceIds)
    ||card.evidenceIds.some(id=>!a.evidence.some(e=>e.id===id))||JSON.stringify(card.nextAnchor)!==JSON.stringify(anchor)
    ||card.status!==(d.score===null?'not_scored':d.score===c.maxScore?'scored_strength':'scored_gap')
    ||Math.abs(card.priority-(d.normalizedScore===null?0:c.weight*(1-d.normalizedScore)))>1e-12)invalid=true;
  }
 }
 for(const p of r.studyPlan){if(!p.feedbackRefs)continue;
  if(new Set(p.feedbackRefs.map(f=>JSON.stringify([f.answerId,f.criterionId]))).size!==p.feedbackRefs.length)invalid=true;
  if(p.feedbackRefs.length){if(p.actions.length!==p.feedbackRefs.length)invalid=true;
   for(const[f,ref]of p.feedbackRefs.entries()){
    const a=r.assessments.find(a=>a.answerId===ref.answerId),card=a?.criterionFeedback?.find(c=>c.criterionId===ref.criterionId);
    if(a?.skillId!==p.skillId||card?.status!=='scored_gap'||card.action!==p.actions[f])invalid=true;
   }
  }
  if(JSON.stringify(p.evidenceAnswerIds)!==JSON.stringify([...new Set(p.feedbackRefs.map(f=>f.answerId))]))invalid=true;
 }
 if(invalid)ctx.addIssue({code:'custom',message:'Feedback must refer to this assessment rubric, scores, evidence and study actions.'});
});
export type ContentReport = z.infer<typeof ContentReportSchema>;
export const ResourceEnrichmentSchema = z.object({ report: ContentReportSchema, queries: z.array(ResourceReceiptSchema).max(3) }).strict();
export type ResourceEnrichment = z.infer<typeof ResourceEnrichmentSchema>;
