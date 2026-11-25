import {z} from 'zod';
import {RoleIdSchema} from './tools.ts';
import {RubricSchema} from './scoring.ts';
import {DataModeSchema,LearningProgressSchema,LearningSummarySchema,PerformancePairSchema,PredictionSchema,ReferenceScoreSchema} from './learning.ts';

const id=z.string().trim().min(1).max(100),time=z.number().int().nonnegative(),sha256=z.string().regex(/^[a-f0-9]{64}$/);
export const LOCAL_LEARNING_CAPABILITY='local-learning-v1' as const;

export const LocalLearningXpSummarySchema=z.object({
 totalXp:z.number().int().nonnegative(),
 level:z.number().int().positive(),
 completedInterviews:z.number().int().nonnegative(),
 verifiedLearnings:z.number().int().nonnegative(),
 completedRetests:z.number().int().nonnegative(),
}).strict();

export const LocalLearningOperationReceiptSchema=z.object({
 operationId:id,
 kind:z.enum(['assignment_create','event_record','practice_verify','retest_pair']),
 digest:sha256,
 processedAt:time,
 result:z.unknown(),
}).strict();

export const LocalLearningRecordSchema=z.object({
 assignmentId:id,
 roleId:RoleIdSchema,
 version:z.number().int().nonnegative(),
 progress:LearningProgressSchema,
 prediction:PredictionSchema,
 retestPair:PerformancePairSchema.nullable(),
 operations:z.array(LocalLearningOperationReceiptSchema).max(200),
}).strict();

export const LocalLearningPublicEventSchema=z.discriminatedUnion('kind',[
 z.object({id,occurredAt:time,kind:z.literal('resource_clicked'),resourceId:id}).strict(),
 z.object({id,occurredAt:time,kind:z.literal('self_reported_complete')}).strict(),
]);

export const LocalLearningStatusInputSchema=z.object({roleId:RoleIdSchema}).strict();
export const LocalLearningCreateAssignmentInputSchema=z.object({
 operationId:id,
 roleId:RoleIdSchema,
 sourceSessionId:id,
 sourceAnswerId:id,
 skillId:id,
 resourceIds:z.array(id).max(20),
 requiredExerciseIds:z.array(id).min(1).max(10),
 dataMode:DataModeSchema.default('synthetic'),
 validDays:z.number().int().min(1).max(7).default(7),
 predictedTargetScore:z.number().min(0).max(1),
 predictorVersion:id.default('local-predictor-v1'),
 targetDifficulty:z.number().int().min(1).max(5).optional(),
 targetRubricId:id.optional(),
 targetRubric:RubricSchema.optional(),
}).strict();

export const LocalLearningRecordEventInputSchema=z.object({
 operationId:id,
 assignmentId:id,
 expectedVersion:z.number().int().nonnegative(),
 event:LocalLearningPublicEventSchema,
}).strict();

export const LocalLearningVerifyPracticeInputSchema=z.object({
 operationId:id,
 assignmentId:id,
 expectedVersion:z.number().int().nonnegative(),
 exerciseId:id,
 artifactId:id,
 verifierId:id,
 verifiedAt:time,
 occurredAt:time,
}).strict();

export const LocalLearningRetestPlanInputSchema=z.object({
 assignmentId:id,
 sessionId:id,
}).strict();

export const LocalLearningRetestPairInputSchema=z.object({
 operationId:id,
 assignmentId:id,
 expectedVersion:z.number().int().nonnegative(),
 retestSessionId:id,
 retestAnswerId:id,
 dataMode:DataModeSchema,
 reference:ReferenceScoreSchema.optional(),
}).strict();

export const LocalLearningAssignmentViewSchema=z.object({
 assignmentId:id,
 roleId:RoleIdSchema,
 skillId:id,
 version:z.number().int().nonnegative(),
 dataMode:DataModeSchema,
 summary:LearningSummarySchema,
 predictionId:id,
 sourceSessionId:id,
 sourceAnswerId:id,
 validUntil:time,
 retestPair:PerformancePairSchema.nullable(),
}).strict();

export const LocalLearningStatusSchema=z.discriminatedUnion('available',[
 z.object({available:z.literal(false),reason:z.literal('LEARNING_STORAGE_UNAVAILABLE'),assignments:z.array(LocalLearningAssignmentViewSchema).length(0),xp:z.null()}).strict(),
 z.object({available:z.literal(true),reason:z.null(),assignments:z.array(LocalLearningAssignmentViewSchema).max(200),xp:LocalLearningXpSummarySchema}).strict(),
]);

export const LocalLearningRetestPlanViewSchema=z.object({
 status:z.enum(['ready','blocked','unavailable']),
 assignmentId:id,
 predictionId:id,
 basedOn:z.object({sessionId:id,stateVersion:time,progressVersion:time,plannedAt:time}).strict(),
 targetSkillId:id,
 targetDifficulty:z.number().int().min(1).max(5),
 candidateAvailable:z.boolean(),
 reasons:z.array(z.string()).optional(),
 reason:z.string().optional(),
}).strict();

export type LocalLearningRecord=z.infer<typeof LocalLearningRecordSchema>;
export type LocalLearningAssignmentView=z.infer<typeof LocalLearningAssignmentViewSchema>;
export type LocalLearningStatus=z.infer<typeof LocalLearningStatusSchema>;
export type LocalLearningRetestPlanView=z.infer<typeof LocalLearningRetestPlanViewSchema>;
export type LocalLearningXpSummary=z.infer<typeof LocalLearningXpSummarySchema>;
