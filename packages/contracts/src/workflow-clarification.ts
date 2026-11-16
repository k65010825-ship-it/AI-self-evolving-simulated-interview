import {z} from 'zod';
import {TurnInputSchema} from './evaluation.ts';
import {UnscoredTurnSchema} from './clarification.ts';
/** Host-retained original answers; never a mastery observation. */
export const WorkflowClarificationAttemptSchema=z.object({input:TurnInputSchema,resolution:UnscoredTurnSchema,
 evidenceMode:z.enum(['offline-fixture','live-model','unverified'])}).strict();
export type WorkflowClarificationAttempt=z.infer<typeof WorkflowClarificationAttemptSchema>;
