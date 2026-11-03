import{z}from'zod';
import{WorkflowSchema}from'./session-workflow.ts';
import{MemoryIdentitySchema}from'./memory.ts';
import{ExperimentRegistrySchema,SessionPolicyPinSchema}from'./experiment.ts';
import{PolicyValidationSuiteSchema,PolicyEvaluationSchema,PolicyCandidateSchema,ReflectionSchema}from'./reflection.ts';
import{PlanningPolicyVersionSchema}from'./policy.ts';
const id=z.string().min(1).max(100);
export const WorkflowRsiInputSchema=z.object({identity:MemoryIdentitySchema,snapshot:WorkflowSchema,
 experimentId:id,registry:ExperimentRegistrySchema,expectedRegistryVersion:z.number().int().nonnegative(),operationId:id,
 suite:PolicyValidationSuiteSchema.optional(),developmentGroupIds:z.array(id).max(100).default([]),
 developmentSessionIds:z.array(id).max(100).default([]),nextSessionId:id,now:z.number().int().nonnegative()}).strict();
export const WorkflowRsiStatusSchema=z.enum(['skipped_no_candidate','evaluated_activated_offline','evaluated_rejected','replayed']);
export const WorkflowRsiResultSchema=z.object({kind:z.literal('uncommitted-workflow-rsi'),scope:z.literal('offline-experiment'),status:WorkflowRsiStatusSchema,
 productionPublished:z.literal(false),evaluationEvidenceMode:z.literal('synthetic'),
 source:z.object({sessionId:id,stateVersion:z.number().int().nonnegative(),workflowRevision:z.number().int().nonnegative(),sourceGroupId:id,
  closeoutAt:z.number().int().nonnegative()}).strict(),sourcePolicy:PlanningPolicyVersionSchema,
 sourceMetrics:ReflectionSchema.shape.metrics,
 isolation:z.object({developmentGroupIds:z.array(id).max(100),developmentSessionIds:z.array(id).max(100),validationGroupIds:z.array(id).max(200)}).strict(),
 changes:PolicyCandidateSchema.shape.changes.nullable(),evaluation:PolicyEvaluationSchema.nullable(),
 operationSeq:z.number().int().positive().nullable(),recordedOutcome:z.enum(['activated','rejected']).nullable(),appliedNow:z.boolean(),
 activeBefore:z.string().min(1),activeAfter:z.string().min(1),registryCandidate:ExperimentRegistrySchema,nextSessionPin:SessionPolicyPinSchema,
 metric:z.literal('synthetic_action_skill_agreement'),reasons:z.array(z.string()),
 explanation:z.object({trigger:z.string().min(1).max(1000),decision:z.string().min(1).max(1000),publication:z.string().min(1).max(1000)}).strict(),
}).strict();
export type WorkflowRsiInput=z.infer<typeof WorkflowRsiInputSchema>;
export type WorkflowRsiResult=z.infer<typeof WorkflowRsiResultSchema>;
