import {z} from 'zod';
import {RoleIdSchema} from './tools.ts';
import {ExperimentRegistrySchema} from './experiment.ts';
import {PolicyValidationSuiteSchema} from './reflection.ts';

const id=z.string().trim().min(1).max(100),time=z.number().int().nonnegative(),sha256=z.string().regex(/^[a-f0-9]{64}$/);
export const LOCAL_EXPERIMENTS_CAPABILITY='local-experiments-v1' as const;

export const LocalExperimentRunRecordSchema=z.object({
 jobId:id,
 operationId:id,
 action:z.enum(['evaluate','rollback']),
 sourceSessionId:id.nullable(),
 status:z.enum(['queued','running','completed','failed','cancelled','interrupted']),
 outcome:z.enum(['activated','rejected','rolled_back','skipped_no_candidate']).nullable(),
 errorCode:z.string().nullable(),
 createdAt:time,
 finishedAt:time.nullable(),
}).strict();

export const LocalExperimentOperationReceiptSchema=z.object({
 operationId:id,
 action:z.enum(['evaluate','rollback']),
 digest:sha256,
 processedAt:time,
 result:z.unknown(),
}).strict();

export const LocalExperimentRecordSchema=z.object({
 experimentId:id,
 roleId:RoleIdSchema,
 version:z.number().int().nonnegative(),
 registry:ExperimentRegistrySchema,
 runs:z.array(LocalExperimentRunRecordSchema).max(200),
 operations:z.array(LocalExperimentOperationReceiptSchema).max(200),
}).strict();

export const LocalExperimentStatusInputSchema=z.object({roleId:RoleIdSchema}).strict();

export const LocalExperimentEvaluateInputSchema=z.object({
 operationId:id,
 experimentId:id,
 roleId:RoleIdSchema,
 sourceSessionId:id,
 expectedRegistryVersion:z.number().int().nonnegative().optional(),
 suite:PolicyValidationSuiteSchema.optional(),
 developmentGroupIds:z.array(id).max(100).default([]),
 developmentSessionIds:z.array(id).max(100).default([]),
 nextSessionId:id,
}).strict();

export const LocalExperimentRollbackInputSchema=z.object({
 operationId:id,
 experimentId:id,
 roleId:RoleIdSchema,
 expectedRegistryVersion:z.number().int().nonnegative(),
 targetPolicyId:id,
 reason:z.string().trim().min(1).max(300),
}).strict();

export const LocalExperimentSummarySchema=z.object({
 experimentId:id,
 roleId:RoleIdSchema,
 version:z.number().int().nonnegative(),
 registryVersion:z.number().int().nonnegative(),
 activePolicyId:id,
 initialPolicyId:id,
 deploymentStatus:z.literal('not_published'),
 runs:z.array(LocalExperimentRunRecordSchema).max(200),
}).strict();

export const LocalExperimentStatusSchema=z.discriminatedUnion('available',[
 z.object({available:z.literal(false),reason:z.literal('EXPERIMENT_STORAGE_UNAVAILABLE'),deploymentStatus:z.literal('not_published'),experiments:z.array(LocalExperimentSummarySchema).length(0)}).strict(),
 z.object({available:z.literal(true),reason:z.null(),deploymentStatus:z.literal('not_published'),experiments:z.array(LocalExperimentSummarySchema).max(50)}).strict(),
]);

export const LocalExperimentActionResultSchema=z.object({
 experimentId:id,
 roleId:RoleIdSchema,
 scope:z.literal('offline-experiment'),
 productionPublished:z.literal(false),
 deploymentStatus:z.literal('not_published'),
 status:z.enum(['skipped_no_candidate','evaluated_activated_offline','evaluated_rejected','replayed','rolled_back']),
 activePolicyId:id,
 registryVersion:z.number().int().nonnegative(),
 outcome:z.enum(['activated','rejected','rolled_back','skipped_no_candidate']).nullable(),
 evaluation:z.object({
  baselineMatched:z.number().int().nonnegative(),
  candidateMatched:z.number().int().nonnegative(),
  total:z.number().int().positive(),
  delta:z.number().min(-1).max(1),
  regressions:z.number().int().nonnegative(),
 }).nullable(),
 reasons:z.array(z.string()),
}).strict();

export type LocalExperimentRecord=z.infer<typeof LocalExperimentRecordSchema>;
export type LocalExperimentStatus=z.infer<typeof LocalExperimentStatusSchema>;
export type LocalExperimentActionResult=z.infer<typeof LocalExperimentActionResultSchema>;
