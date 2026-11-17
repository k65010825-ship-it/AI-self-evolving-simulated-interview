import{z}from'zod';
import{RoleIdSchema}from'./tools.ts';
import{ReportInputSchema,EvidenceModeSchema}from'./report.ts';
import{RubricSchema}from'./scoring.ts';
const id=z.string().trim().min(1).max(100),time=z.number().int().nonnegative();
export const DataModeSchema=z.enum(['synthetic','consented','unverified']);
export const LearningIdentitySchema=z.object({userId:z.string().min(1),roleId:RoleIdSchema,assignmentId:id}).strict();
const event=z.object({id,occurredAt:time});
export const LearningEventSchema=z.discriminatedUnion('kind',[
 event.extend({kind:z.literal('resource_clicked'),resourceId:id}).strict(),
 event.extend({kind:z.literal('self_reported_complete')}).strict(),
 event.extend({kind:z.literal('practice_verified'),exerciseId:id,
  verification:z.object({artifactId:id,verifierId:id,verifiedAt:time}).strict()}).strict(),
]);
export const CreateLearningSchema=LearningIdentitySchema.extend({skillId:id,resourceIds:z.array(id).max(20),requiredExerciseIds:z.array(id).min(1).max(10),dataMode:DataModeSchema,now:time}).strict();
export const LearningProgressSchema=LearningIdentitySchema.extend({schemaVersion:z.literal(1),kind:z.literal('uncommitted-learning-progress'),
 skillId:id,resourceIds:z.array(id).max(20),requiredExerciseIds:z.array(id).min(1).max(10),dataMode:DataModeSchema,
 version:z.number().int().nonnegative(),createdAt:time,updatedAt:time,
 events:z.array(z.object({event:LearningEventSchema,acceptedAt:time}).strict()).max(100)}).strict().superRefine((s,ctx)=>{
 let invalid=s.version!==s.events.length||s.updatedAt<s.createdAt||new Set(s.resourceIds).size!==s.resourceIds.length
  ||new Set(s.requiredExerciseIds).size!==s.requiredExerciseIds.length||new Set(s.events.map(e=>e.event.id)).size!==s.events.length;
 let acceptedAt=s.createdAt;const artifacts=new Set<string>();
 for(const item of s.events){const e=item.event;
  if(item.acceptedAt<acceptedAt||item.acceptedAt>s.updatedAt||e.occurredAt<s.createdAt||e.occurredAt>item.acceptedAt)invalid=true;
  if(e.kind==='resource_clicked'&&!s.resourceIds.includes(e.resourceId))invalid=true;
  if(e.kind==='practice_verified'){
   if(!s.requiredExerciseIds.includes(e.exerciseId)||e.verification.verifiedAt<s.createdAt||e.verification.verifiedAt>e.occurredAt||artifacts.has(e.verification.artifactId))invalid=true;
   artifacts.add(e.verification.artifactId);
  }acceptedAt=item.acceptedAt;
 }
 if(s.updatedAt!==acceptedAt)invalid=true;
 if(invalid)ctx.addIssue({code:'custom',message:'Invalid learning event references or chronology.'});
});
export const RecordLearningEventSchema=LearningIdentitySchema.extend({expectedVersion:z.number().int().nonnegative(),now:time,event:LearningEventSchema}).strict();
export const LearningSummarySchema=z.object({status:z.enum(['not_started','in_progress','self_reported','verified_complete']),
 verifiedExerciseIds:z.array(id),requiredExercises:z.number().int().positive(),verifiedCompleteAt:time.nullable()}).strict();
const target=z.object({difficulty:z.number().int().min(1).max(5),rubric:RubricSchema}).strict();
export const PredictionSchema=LearningIdentitySchema.extend({kind:z.literal('frozen-learning-prediction'),predictionId:id,skillId:id,dataMode:DataModeSchema,
 issuedAt:time,validUntil:time,predictedTargetScore:z.number().min(0).max(1),predictorVersion:id,target,
 expectedExerciseIds:z.array(id).min(1).max(10),sourceSessionId:id,sourceAnswerId:id,sourceQuestionIds:z.array(id).min(1).max(4400),
 sourceModelScore:z.number().min(0).max(1),sourceEvidenceMode:EvidenceModeSchema}).strict().superRefine((p,ctx)=>{
 if(p.validUntil<=p.issuedAt||p.validUntil-p.issuedAt>7*86400000||p.target.rubric.roleId!==p.roleId
  ||new Set(p.expectedExerciseIds).size!==p.expectedExerciseIds.length||new Set(p.sourceQuestionIds).size!==p.sourceQuestionIds.length)
  ctx.addIssue({code:'custom',message:'Invalid prediction window or target.'});
});
export const CreatePredictionSchema=LearningIdentitySchema.extend({predictionId:id,progress:LearningProgressSchema,
 sourceReportInput:ReportInputSchema,sourceAnswerId:id,issuedAt:time,validUntil:time,predictedTargetScore:z.number().min(0).max(1),predictorVersion:id,target}).strict();
export const ReferenceScoreSchema=z.object({basis:z.enum(['human-reviewed','synthetic-fixture','unverified']),reviewId:id,reviewerId:id,
 answerId:id,rubricId:id,rubricVersion:id,score:z.number().min(0).max(1),reviewedAt:time}).strict();
export const PairRetestSchema=LearningIdentitySchema.extend({prediction:PredictionSchema,progress:LearningProgressSchema,retestReportInput:ReportInputSchema,
 retestAnswerId:id,questionIssuedAt:time,answerSubmittedAt:time,now:time,dataMode:DataModeSchema,reference:ReferenceScoreSchema.optional()}).strict();
export const PairReasonSchema=z.enum(['learning_not_verified','learning_outside_window','prediction_after_retest_exposure','prediction_expired',
 'question_repeated','session_reused','role_mismatch','skill_mismatch','difficulty_mismatch','rubric_mismatch','reference_missing','reference_mismatch',
 'reference_unverified','assisted_answer','data_mode_mismatch','unverified_data_mode','model_source_unverified']);
export const PerformancePairSchema=LearningIdentitySchema.extend({kind:z.literal('uncommitted-performance-pair'),predictionId:id,skillId:id,
 status:z.enum(['eligible','ineligible']),reasons:z.array(PairReasonSchema),dataMode:DataModeSchema,predictorVersion:id,target,
 sourceSessionId:id,retestSessionId:id,retestAnswerId:id,retestQuestionId:id,predictedTargetScore:z.number().min(0).max(1),
 referenceScore:z.number().min(0).max(1).nullable(),referenceReviewId:id.nullable(),absoluteError:z.number().min(0).max(1).nullable()}).strict().superRefine((p,ctx)=>{
 const valid=p.status==='eligible'?p.reasons.length===0&&p.dataMode!=='unverified'&&p.target.rubric.roleId===p.roleId&&p.referenceScore!==null&&p.referenceReviewId!==null&&p.absoluteError!==null
  &&Math.abs(p.absoluteError-Math.abs(p.predictedTargetScore-p.referenceScore))<1e-12:p.reasons.length>0&&p.referenceScore===null&&p.absoluteError===null;
 if(!valid)ctx.addIssue({code:'custom',message:'Pair status and metrics disagree.'});
});
export const CalibrationInputSchema=z.object({roleId:RoleIdSchema,skillId:id,dataMode:DataModeSchema,predictorVersion:id,targetDifficulty:target.shape.difficulty,
 targetRubric:RubricSchema,pairs:z.array(PerformancePairSchema).max(1000)}).strict();
export const CalibrationSummarySchema=z.object({kind:z.literal('descriptive-calibration-summary'),roleId:RoleIdSchema,skillId:id,dataMode:DataModeSchema,
 predictorVersion:id,targetDifficulty:target.shape.difficulty,targetRubricId:id,targetRubricVersion:id,
 status:z.enum(['ready','insufficient_data']),eligiblePairs:z.number().int().nonnegative(),excludedPairs:z.number().int().nonnegative(),
 distinctStudents:z.number().int().nonnegative(),minimumPairs:z.literal(8),minimumStudents:z.literal(2),mae:z.number().min(0).max(1).nullable()}).strict();
export type LearningProgress=z.infer<typeof LearningProgressSchema>;
export type LearningSummary=z.infer<typeof LearningSummarySchema>;
export type Prediction=z.infer<typeof PredictionSchema>;
export type PerformancePair=z.infer<typeof PerformancePairSchema>;
export type CalibrationSummary=z.infer<typeof CalibrationSummarySchema>;
