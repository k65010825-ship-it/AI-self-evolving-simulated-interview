import {z} from 'zod';
export const BindingInvalidDetailSchema=z.enum(['unexpected-binding','goal-id-mismatch','goal-version-mismatch','unexpected-observation',
 'unit-missing','unit-uncited','unit-invalid','span-unit-mismatch','span-range-invalid','span-overlap',
 'observation-span-unit-mismatch','observation-span-range-invalid','observation-outside-expectation','observation-span-overlap']);
export type BindingInvalidDetail=z.infer<typeof BindingInvalidDetailSchema>;
const relation=z.enum(['identical','contains','contained-by','partial-overlap']);
/** Static field names only; no offsets, evidence IDs or model excerpts. */
export const BindingSpanConflictSchema=z.union([
 z.object({parts:z.tuple([z.literal('action'),z.enum(['target','expectation'])]),relation}).strict(),
 z.object({parts:z.tuple([z.literal('target'),z.literal('expectation')]),relation}).strict(),
 z.object({parts:z.tuple([z.literal('metric'),z.literal('value')]),relation}).strict(),
]);
export type BindingSpanConflict=z.infer<typeof BindingSpanConflictSchema>;
const id=z.string().trim().min(1).max(100);
const aliases=z.array(z.string().trim().min(1).max(80)).min(1).max(12).refine(v=>new Set(v).size===v.length,'Duplicate aliases');
export const ObservationPolicySchema=z.object({kind:z.enum(['count','duration']),conditionAliases:aliases,predicateAliases:aliases.optional()}).strict();
/** Host-owned versioned rubric requirement, never supplied as model authority. */
export const VerificationGoalSchema=z.object({id,version:id,actionAliases:aliases,targetAliases:aliases,observationAliases:aliases,observationPolicy:ObservationPolicySchema.optional()}).strict();
const span=z.object({evidenceId:id,start:z.number().int().nonnegative(),end:z.number().int().nonnegative()}).strict();
/** Model-proposed UTF-16 spans inside one registered/cited evidence unit. Not proof of execution. */
export const VerificationBindingSchema=z.object({goalId:id,goalVersion:id,mode:z.enum(['proposed','reported']),action:span,target:span,expectation:span,observation:z.object({metric:span,value:span,condition:span}).strict().optional()}).strict();
export type VerificationGoal=z.infer<typeof VerificationGoalSchema>;
export type VerificationBinding=z.infer<typeof VerificationBindingSchema>;
