import {z} from 'zod';
import {RoleIdSchema} from './tools.ts';
import {PracticeModeSchema} from './role-catalog.ts';
export const PlanningPolicySchema=z.object({maxFollowupDepth:z.number().int().min(0).max(5).default(2),
 wrapUpSeconds:z.number().int().min(0).max(300).default(30),maxTurns:z.number().int().min(1).max(200).default(12),
 difficultyProgression:z.literal('independent-evidence-v1').optional(),
 questionFallback:z.literal('catalog-unseen-v1').optional(),
 practiceMode:PracticeModeSchema.optional()}).strict();
export const PlanningPolicyVersionSchema=z.object({id:z.string().min(1).max(80),roleId:RoleIdSchema,parameters:PlanningPolicySchema}).strict();
/** Inputs must be normalized by PlanningPolicySchema. Unlisted/new parameters cannot change. */
export function isOneStepDepthReduction(before:z.infer<typeof PlanningPolicySchema>,after:z.infer<typeof PlanningPolicySchema>){
 return after.maxFollowupDepth>=1&&JSON.stringify(after)===JSON.stringify({...before,maxFollowupDepth:before.maxFollowupDepth-1});
}
